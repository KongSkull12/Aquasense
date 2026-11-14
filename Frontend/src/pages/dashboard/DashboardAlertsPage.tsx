import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import type { AlertSeverity, AlertStatus, HealthAlert } from '../../types/water';
import type { SmsLogEntry } from '../../types/sms';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { downloadExcelWorkbook } from '../../utils/excelDownload';
import { EmptyState, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';

const maskPhone = (phone: string) => {
  if (!phone || phone.length < 7) return 'Hidden';
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
};

const normalizeSeverity = (severity: AlertSeverity | string = 'INFO') => severity.toUpperCase();

const isCriticalAlert = (alert: HealthAlert) => {
  const severity = normalizeSeverity(alert.severity);
  return severity === 'CRITICAL' || severity === 'EMERGENCY';
};

const getSeverityState = (severity: AlertSeverity | string): MarkState => {
  const normalized = normalizeSeverity(severity);
  if (normalized === 'EMERGENCY' || normalized === 'CRITICAL') return 'alarm';
  if (normalized === 'WARNING') return 'warn';
  if (normalized === 'INFO') return 'info';
  return 'off';
};

const titleCase = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

const formatCategory = (alert: HealthAlert) => titleCase(alert.category || alert.parameter || 'Water quality');

const getAlertTime = (alert: HealthAlert) => alert.createdAt || alert.timestamp || alert.updatedAt || new Date().toISOString();

const getAlertValue = (alert: HealthAlert) => {
  const value = alert.currentValue ?? alert.value;
  if (value === undefined || value === null) return '';
  return Number(value);
};

const getAlertThreshold = (alert: HealthAlert) => {
  const threshold = alert.thresholdValue ?? alert.threshold;
  if (threshold === undefined || threshold === null) return '';
  return Number(threshold);
};

const getActionLabel = (alert: HealthAlert) => (alert.action || 'Review tank').replace(/_/g, ' ').toLowerCase();

const toDateInput = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const startOfMonth = (year: number, monthIndex: number) => new Date(year, monthIndex, 1);
const endOfMonth = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0);

const monthOptions = (() => {
  const now = new Date();
  const options: Array<{ value: string; label: string; from: string; to: string }> = [];
  for (let i = 0; i < 12; i += 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const from = toDateInput(startOfMonth(cursor.getFullYear(), cursor.getMonth()));
    const to = toDateInput(endOfMonth(cursor.getFullYear(), cursor.getMonth()));
    const label = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    options.push({ value: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`, label, from, to });
  }
  return options;
})();

type StatusFilter = 'ALL' | AlertStatus;

const PAGE_SIZE = 10;

const LogPager = ({
  page,
  pageCount,
  total,
  onChange,
  label,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
  label: string;
}) => {
  if (total <= PAGE_SIZE) return null;
  const fromRow = (page - 1) * PAGE_SIZE + 1;
  const toRow = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-3 sm:px-5">
      <p className="num text-xs text-ink-3">{fromRow}–{toRow} of {total} {label}</p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
        <span className="num text-xs text-ink-3">Page {page} / {pageCount}</span>
        <button type="button" className="btn-secondary btn-sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
};

const DashboardAlertsPage: React.FC = () => {
  const { activeAlerts, smsLogs } = useDashboardData();
  const thisMonth = monthOptions[0];

  const [monthKey, setMonthKey] = useState(thisMonth.value);
  const [from, setFrom] = useState(thisMonth.from);
  const [to, setTo] = useState(thisMonth.to);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [history, setHistory] = useState<HealthAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alertPage, setAlertPage] = useState(1);
  const [smsPage, setSmsPage] = useState(1);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (status !== 'ALL') params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const response = await apiClient.get<HealthAlert[]>(`/alerts?${params.toString()}`);
      setHistory(response.data || []);
      setAlertPage(1);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load alert history.'));
      setHistory([]);
      setAlertPage(1);
    } finally {
      setLoading(false);
    }
  }, [from, to, status]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setSmsPage(1);
  }, [from, to, smsLogs]);

  const applyMonth = (value: string) => {
    setMonthKey(value);
    if (value === 'custom') return;
    const match = monthOptions.find((option) => option.value === value);
    if (!match) return;
    setFrom(match.from);
    setTo(match.to);
  };

  const onFromChange = (value: string) => {
    setFrom(value);
    setMonthKey('custom');
  };

  const onToChange = (value: string) => {
    setTo(value);
    setMonthKey('custom');
  };

  const active = activeAlerts || [];
  const criticalActive = active.filter(isCriticalAlert);
  const filteredSms = useMemo(() => {
    const start = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const end = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    return smsLogs.filter((log) => {
      const at = new Date(log.sentAt).getTime();
      if (!Number.isFinite(at)) return false;
      if (start != null && at < start) return false;
      if (end != null && at > end) return false;
      return true;
    });
  }, [smsLogs, from, to]);

  const sentSms = filteredSms.filter((log) => log.success || ['pending', 'retrying'].includes(log.deliveryStatus || '')).length;
  const failedSms = filteredSms.filter((log) => !log.success && !['pending', 'retrying', 'unknown'].includes(log.deliveryStatus || '')).length;

  const alertPageCount = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const smsPageCount = Math.max(1, Math.ceil(filteredSms.length / PAGE_SIZE));
  const safeAlertPage = Math.min(alertPage, alertPageCount);
  const safeSmsPage = Math.min(smsPage, smsPageCount);
  const pagedHistory = history.slice((safeAlertPage - 1) * PAGE_SIZE, safeAlertPage * PAGE_SIZE);
  const pagedSms = filteredSms.slice((safeSmsPage - 1) * PAGE_SIZE, safeSmsPage * PAGE_SIZE);

  const summary: Array<{ label: string; value: number; detail: string; state: MarkState }> = [
    { label: 'Active now', value: active.length, detail: active.length ? 'Needs review' : 'All clear', state: active.length ? 'warn' : 'ok' },
    { label: 'Critical now', value: criticalActive.length, detail: criticalActive.length ? 'Check the tank' : 'Nothing urgent', state: criticalActive.length ? 'alarm' : 'ok' },
    { label: 'In range', value: history.length, detail: loading ? 'Loading…' : `${from || '…'} → ${to || '…'}`, state: 'info' },
    { label: 'SMS in range', value: filteredSms.length, detail: failedSms ? `${failedSms} failed` : `${sentSms} sent/queued`, state: failedSms ? 'warn' : 'ok' },
  ];

  const downloadExcel = () => {
    const alertRows = history.map((alert) => [
      new Date(getAlertTime(alert)).toLocaleString(),
      formatCategory(alert),
      titleCase(normalizeSeverity(alert.severity)),
      alert.message || '',
      getAlertValue(alert),
      getAlertThreshold(alert),
      alert.unit || '',
      alert.status ? titleCase(alert.status) : '',
      getActionLabel(alert),
      alert.smsSentAt ? new Date(alert.smsSentAt).toLocaleString() : '',
    ]);
    const smsRows = filteredSms.map((log: SmsLogEntry) => [
      new Date(log.sentAt).toLocaleString(),
      titleCase(log.category),
      titleCase(log.severity),
      maskPhone(log.recipient),
      log.deliveryStatus || (log.success ? 'sent' : 'failed'),
      log.success ? 'Yes' : 'No',
    ]);
    downloadExcelWorkbook(`AquaSense-alerts-${from || 'all'}-to-${to || 'all'}`, [
      {
        name: 'Alerts',
        headers: ['When', 'Sensor', 'Severity', 'Message', 'Current', 'Limit', 'Unit', 'Status', 'Action', 'SMS sent at'],
        rows: alertRows,
      },
      {
        name: 'SMS log',
        headers: ['When', 'Category', 'Severity', 'Recipient', 'Delivery', 'Success'],
        rows: smsRows,
      },
    ]);
  };

  return (
    <div className="space-y-5">
      <PageHead
        title="Alerts & logs"
        description="Active problems and filtered alert history. Download the current filter as an Excel file."
        actions={(
          <button type="button" className="btn-secondary" disabled={loading || (!history.length && !filteredSms.length)} onClick={downloadExcel}>
            Download Excel
          </button>
        )}
      />

      <section aria-label="Summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line xl:grid-cols-4">
        {summary.map((item) => (
          <div key={item.label} className="bg-white px-4 py-3.5 sm:px-5 sm:py-4">
            <p className="text-[13px] font-medium text-ink-2">{item.label}</p>
            <p className="num mt-1.5 text-[28px] font-semibold leading-none">{item.value}</p>
            <StateMark state={item.state} className="mt-2.5 !text-xs">{item.detail}</StateMark>
          </div>
        ))}
      </section>

      <Panel title="Filter" description="Pick a month or set your own dates. Status filters the history table.">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="field-label" htmlFor="alert-month">Month</label>
            <select
              id="alert-month"
              className="field min-w-[180px]"
              value={monthKey}
              onChange={(event) => applyMonth(event.target.value)}
            >
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value="custom">Custom dates</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="alert-from">From</label>
            <input id="alert-from" type="date" className="field num" value={from} onChange={(event) => onFromChange(event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="alert-to">To</label>
            <input id="alert-to" type="date" className="field num" value={to} onChange={(event) => onToChange(event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="alert-status">Status</label>
            <select
              id="alert-status"
              className="field min-w-[140px]"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
          <button type="button" className="btn-primary" disabled={loading} onClick={() => void loadHistory()}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-[13px] text-alarm">{error}</p>}
      </Panel>

      {criticalActive[0] && (
        <section aria-label="Most recent critical alert" className="rounded-lg border border-alarm/30 bg-alarm-bg px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-alarm">Critical · {formatCategory(criticalActive[0])}</p>
              <p className="mt-1 text-[13px] text-ink-2">{criticalActive[0].message}</p>
              <p className="num mt-2 text-xs text-ink-3">
                Current {getAlertValue(criticalActive[0]) || '—'}{criticalActive[0].unit ? ` ${criticalActive[0].unit}` : ''}
                {' · '}Limit {getAlertThreshold(criticalActive[0]) || '—'}
                {' · '}{new Date(getAlertTime(criticalActive[0])).toLocaleString()}
              </p>
            </div>
            {criticalActive.length > 1 && <p className="text-xs text-[#7a1a12]">{criticalActive.length - 1} more active critical</p>}
          </div>
        </section>
      )}

      <Panel
        title="Alert history"
        description="Sensor alerts in the selected date range · 10 per page."
        actions={<span className="num text-xs text-ink-3">{loading ? '…' : `${history.length} rows`}</span>}
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="p-5 text-sm text-ink-3">Loading alerts…</div>
        ) : history.length === 0 ? (
          <div className="p-5"><EmptyState title="No alerts in this range">Try another month or widen the dates.</EmptyState></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-line text-xs text-ink-3">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">When</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Sensor</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Severity</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Reading</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {pagedHistory.map((alert) => {
                    const current = getAlertValue(alert);
                    const limit = getAlertThreshold(alert);
                    return (
                      <tr key={alert.id} className="hover:bg-water">
                        <td className="num whitespace-nowrap px-5 py-2.5 text-ink-2">{new Date(getAlertTime(alert)).toLocaleString()}</td>
                        <td className="px-3 py-2.5 font-medium">{formatCategory(alert)}</td>
                        <td className="px-3 py-2.5"><StateMark state={getSeverityState(alert.severity)} className="!text-xs">{titleCase(normalizeSeverity(alert.severity))}</StateMark></td>
                        <td className="num px-3 py-2.5 text-ink-2">
                          {current === '' ? '—' : current}{alert.unit ? ` ${alert.unit}` : ''}
                          {limit !== '' && <span className="text-ink-3"> / {limit}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-ink-2">{alert.status ? titleCase(alert.status) : '—'}</td>
                        <td className="max-w-[280px] truncate px-5 py-2.5 text-ink-2" title={alert.message}>{alert.message}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <LogPager page={safeAlertPage} pageCount={alertPageCount} total={history.length} onChange={setAlertPage} label="alerts" />
          </>
        )}
      </Panel>

      <Panel
        title="SMS log"
        description="Texts in the same date range · 10 per page."
        actions={<span className="num text-xs text-ink-3">{filteredSms.length} messages</span>}
        bodyClassName="p-0"
      >
        {filteredSms.length === 0 ? (
          <div className="p-5"><EmptyState title="No SMS in this range">Sent and failed attempts for these dates appear here.</EmptyState></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-line text-xs text-ink-3">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">When</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Alert</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Number</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {pagedSms.map((log) => {
                    const pending = ['pending', 'retrying', 'unknown'].includes(log.deliveryStatus || '');
                    const label = log.deliveryStatus === 'unknown' ? 'Unconfirmed' : (log.deliveryStatus || (log.success ? 'Sent' : 'Failed'));
                    return (
                      <tr key={log.id} className="hover:bg-water">
                        <td className="num whitespace-nowrap px-5 py-2.5 text-ink-2">{new Date(log.sentAt).toLocaleString()}</td>
                        <td className="px-3 py-2.5 font-medium">{titleCase(log.category)}</td>
                        <td className="num px-3 py-2.5 text-ink-2">{maskPhone(log.recipient)}</td>
                        <td className="px-5 py-2.5"><StateMark state={log.success ? 'ok' : pending ? 'warn' : 'alarm'} className="!text-xs">{label.charAt(0).toUpperCase() + label.slice(1)}</StateMark></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <LogPager page={safeSmsPage} pageCount={smsPageCount} total={filteredSms.length} onChange={setSmsPage} label="messages" />
          </>
        )}
      </Panel>
    </div>
  );
};

export default DashboardAlertsPage;
