import React from 'react';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import type { AlertSeverity, HealthAlert } from '../../types/water';
import type { SmsLogEntry } from '../../types/sms';
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
  if (value === undefined) return '—';
  return `${value.toFixed(2)}${alert.unit ? ` ${alert.unit}` : ''}`;
};

const getAlertThreshold = (alert: HealthAlert) => {
  const threshold = alert.thresholdValue ?? alert.threshold;
  if (threshold === undefined) return '—';
  return `${threshold.toFixed(2)}${alert.unit ? ` ${alert.unit}` : ''}`;
};

const getActionLabel = (alert: HealthAlert) => (alert.action || 'Review tank').replace(/_/g, ' ').toLowerCase();

const AlertRow = ({ alert, showAction = false }: { alert: HealthAlert; showAction?: boolean }) => (
  <li className="px-4 py-3.5 sm:px-5">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm font-semibold">{formatCategory(alert)}</p>
          <StateMark state={getSeverityState(alert.severity)} className="!text-xs">{titleCase(normalizeSeverity(alert.severity))}</StateMark>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{alert.message}</p>
      </div>
      <time className="num shrink-0 text-xs text-ink-3" dateTime={new Date(getAlertTime(alert)).toISOString()}>{new Date(getAlertTime(alert)).toLocaleTimeString()}</time>
    </div>
    <dl className="num mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-3">
      <div className="flex gap-1.5"><dt>Current</dt><dd className="font-semibold text-ink">{getAlertValue(alert)}</dd></div>
      <div className="flex gap-1.5"><dt>Limit</dt><dd className="font-semibold text-ink">{getAlertThreshold(alert)}</dd></div>
      {alert.status && <div className="flex gap-1.5"><dt>Status</dt><dd className="font-semibold text-ink">{titleCase(alert.status)}</dd></div>}
    </dl>
    {showAction && (
      <p className="mt-2 text-[13px] text-ink">
        <span className="text-ink-3">Recommended: </span>
        <span className="font-semibold">{getActionLabel(alert).replace(/^\w/, (char) => char.toUpperCase())}</span>
      </p>
    )}
  </li>
);

const SmsRow = ({ log }: { log: SmsLogEntry }) => {
  const pending = ['pending', 'retrying', 'unknown'].includes(log.deliveryStatus || '');
  const label = log.deliveryStatus === 'unknown' ? 'Unconfirmed' : (log.deliveryStatus || (log.success ? 'Sent' : 'Failed'));
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{titleCase(log.category)}</p>
        <p className="num mt-0.5 text-xs text-ink-3">{new Date(log.sentAt).toLocaleString()} · {maskPhone(log.recipient)}</p>
      </div>
      <StateMark state={log.success ? 'ok' : pending ? 'warn' : 'alarm'} className="shrink-0 !text-xs">{label.charAt(0).toUpperCase() + label.slice(1)}</StateMark>
    </li>
  );
};

const ListPanel = ({ title, count, children }: { title: string; count: string; children: React.ReactNode }) => (
  <Panel title={title} actions={<span className="num text-xs text-ink-3">{count}</span>} bodyClassName="max-h-[460px] overflow-y-auto">
    {children}
  </Panel>
);

const DashboardAlertsPage: React.FC = () => {
  const { activeAlerts, recentAlerts, smsLogs } = useDashboardData();
  const active = activeAlerts || [];
  const recent = recentAlerts?.length ? recentAlerts : active;
  const critical = active.filter(isCriticalAlert);
  const sentSms = smsLogs.filter((log) => log.success).length;
  const failedSms = smsLogs.filter((log) => !log.success && !['pending', 'retrying', 'unknown'].includes(log.deliveryStatus || '')).length;
  const pendingSms = smsLogs.filter((log) => ['pending', 'retrying', 'unknown'].includes(log.deliveryStatus || '')).length;
  const latestCritical = critical[0];

  const summary: Array<{ label: string; value: number; detail: string; state: MarkState }> = [
    { label: 'Active alerts', value: active.length, detail: active.length ? 'Needs review' : 'No active issues', state: active.length ? 'warn' : 'ok' },
    { label: 'Critical', value: critical.length, detail: critical.length ? 'Check the tank first' : 'Nothing urgent', state: critical.length ? 'alarm' : 'ok' },
    { label: 'SMS sent', value: sentSms, detail: `${pendingSms} pending or unconfirmed`, state: 'info' },
    { label: 'SMS failed', value: failedSms, detail: failedSms ? 'Check connection or SMS API' : 'No failed sends', state: failedSms ? 'warn' : 'ok' },
  ];

  return (
    <div className="space-y-5">
      <PageHead title="Alerts & logs" description="Active problems, critical warnings, and the SMS notification history." />

      <section aria-label="Summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line xl:grid-cols-4">
        {summary.map((item) => (
          <div key={item.label} className="bg-white px-4 py-3.5 sm:px-5 sm:py-4">
            <p className="text-[13px] font-medium text-ink-2">{item.label}</p>
            <p className="num mt-1.5 text-[28px] font-semibold leading-none">{item.value}</p>
            <StateMark state={item.state} className="mt-2.5 !text-xs">{item.detail}</StateMark>
          </div>
        ))}
      </section>

      {latestCritical && (
        <section aria-label="Most recent critical alert" className="rounded-lg border border-alarm/30 bg-alarm-bg">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-3 sm:px-5">
            <h2 className="text-sm font-semibold text-alarm">Critical</h2>
            {critical.length > 1 && <p className="text-xs text-[#7a1a12]">{critical.length - 1} more in active alerts</p>}
          </div>
          <ul><AlertRow alert={latestCritical} showAction /></ul>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <ListPanel title="Active alerts" count={`${active.length} active`}>
          {active.length === 0 ? (
            <div className="p-5"><EmptyState title="All clear">There are no active alerts for the tank.</EmptyState></div>
          ) : (
            <ul className="divide-y divide-line-soft">{active.slice(0, 8).map((alert) => <AlertRow key={alert.id} alert={alert} showAction />)}</ul>
          )}
        </ListPanel>

        <ListPanel title="Recent alerts" count={`${recent.length} records`}>
          {recent.length === 0 ? (
            <div className="p-5"><EmptyState title="No alert history yet">Alerts appear here once sensor readings trigger a warning.</EmptyState></div>
          ) : (
            <ul className="divide-y divide-line-soft">{recent.slice(0, 10).map((alert) => <AlertRow key={alert.id} alert={alert} />)}</ul>
          )}
        </ListPanel>

        <ListPanel title="SMS log" count={`${smsLogs.length} messages`}>
          {smsLogs.length === 0 ? (
            <div className="p-5"><EmptyState title="No SMS sent yet">Sent and failed SMS attempts are listed here.</EmptyState></div>
          ) : (
            <ul className="divide-y divide-line-soft">{smsLogs.slice(0, 10).map((log) => <SmsRow key={log.id} log={log} />)}</ul>
          )}
        </ListPanel>

        {!latestCritical && (
          <ListPanel title="Critical" count="0 urgent">
            <div className="p-5"><EmptyState title="No urgent alert">Emergency and critical alerts are pinned to the top of this page when they happen.</EmptyState></div>
          </ListPanel>
        )}
      </div>
    </div>
  );
};

export default DashboardAlertsPage;
