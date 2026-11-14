import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { Notice, PageHead, Panel, StateMark } from '../../components/WaterQuality/Console';

const SLOTS = 4;
const GLOBE_OR_DITO = new Set([
  '0817', '0904', '0905', '0906', '0915', '0916', '0917', '0926', '0927',
  '0935', '0936', '0937', '0945', '0953', '0954', '0955', '0956', '0957', '0958', '0959',
  '0965', '0966', '0967', '0975', '0976', '0977', '0978', '0979', '0995', '0996', '0997',
  '0895', '0896', '0897', '0898', '0991', '0992', '0993', '0994',
]);

const reachesDefaultSender = (phone: string): boolean => {
  const digits = phone.replace(/\D/g, '');
  const local = digits.startsWith('63') ? `0${digits.slice(2)}` : digits;
  if (local.length < 11) return true;
  if (['09253', '09255', '09256', '09257', '09258'].includes(local.slice(0, 5))) return true;
  return GLOBE_OR_DITO.has(local.slice(0, 4));
};

type SmsProvider = 'unisms' | 'semaphore' | 'iprogsms';

interface SmsRecipientList {
  enabled: boolean;
  phones: string[];
  saved: boolean;
  /** Missing on backends before v1.9.0, which always used UniSMS. */
  provider?: SmsProvider;
}

interface TestResult {
  recipient: string;
  status: string;
  accepted: boolean;
}

const DashboardSmsPage: React.FC = () => {
  const [enabled, setEnabled] = useState(true);
  const [phones, setPhones] = useState<string[]>(Array.from({ length: SLOTS }, () => ''));
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [provider, setProvider] = useState<SmsProvider>('iprogsms');

  const applyList = (list: SmsRecipientList) => {
    setEnabled(list.enabled);
    setProvider(
      list.provider === 'semaphore' ? 'semaphore'
        : list.provider === 'unisms' ? 'unisms'
          : 'iprogsms',
    );
    setPhones(Array.from({ length: SLOTS }, (_, index) => list.phones[index] || ''));
  };

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get<SmsRecipientList>('/sms/recipients');
      applyList(response.data);
      setSaved(true);
      setError(null);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load SMS numbers.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending('save');
    setError(null);
    setNotice(null);
    setTestResults(null);
    try {
      const response = await apiClient.put<SmsRecipientList>('/sms/recipients', {
        enabled,
        phones: phones.map((phone) => phone.trim()).filter(Boolean),
      });
      applyList(response.data);
      setSaved(true);
      setNotice(response.data.phones.length ? 'Numbers saved.' : 'Saved with no numbers. Alerts will not send SMS until you add one.');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to save SMS numbers.'));
    } finally {
      setPending(null);
    }
  };

  const sendTest = async () => {
    setPending('test');
    setError(null);
    setNotice(null);
    setTestResults(null);
    try {
      const response = await apiClient.post<{ results: TestResult[] }>('/sms/test', {}, 60000);
      setTestResults(response.data.results || []);
      setNotice(response.message);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Test SMS could not be sent.'));
    } finally {
      setPending(null);
    }
  };

  const filled = phones.some((phone) => phone.trim());

  return (
    <div className="space-y-5">
      <PageHead
        title="SMS alerts"
        description="Up to four mobile numbers. Warning, critical and emergency readings for each sensor (temperature, pH, turbidity, dissolved oxygen) automatically text every saved number."
        meta={saved ? <StateMark state="ok" className="!text-sm !font-semibold">Saved</StateMark> : undefined}
      />

      <form onSubmit={(event) => void save(event)} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Mobile numbers" description="Use 09XXXXXXXXX or +639XXXXXXXXX. Empty rows are ignored.">
          <div className="space-y-3">
            {phones.map((phone, index) => (
              <div key={index}>
                <label className="field-label" htmlFor={`sms-phone-${index}`}>Number {index + 1}</label>
                <input
                  id={`sms-phone-${index}`}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  disabled={loading || pending !== null}
                  onChange={(event) => {
                    const next = [...phones];
                    next[index] = event.target.value;
                    setPhones(next);
                    setSaved(false);
                  }}
                  placeholder="09XXXXXXXXX"
                  className="field num max-w-sm"
                />
              </div>
            ))}
            <p className="text-xs leading-relaxed text-ink-3">A repeat of the same number is stored once. The list replaces the single server number for this account after you save.</p>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Alert texts">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={loading || pending !== null}
              onClick={() => { setEnabled((current) => !current); setSaved(false); }}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5 text-left"
            >
              <span>
                <span className="block text-sm font-semibold">{enabled ? 'SMS on' : 'SMS off'}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">While on, each sensor warning or alert sends a text (15 min cooldown per sensor; 5 min for emergencies).</span>
              </span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-ok' : 'bg-line'}`} aria-hidden="true">
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </span>
            </button>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" className="btn-primary" disabled={loading || pending !== null}>
                {pending === 'save' ? 'Saving…' : 'Save numbers'}
              </button>
              <button type="button" className="btn-secondary" disabled={loading || pending !== null || !filled || !saved} onClick={() => void sendTest()}>
                {pending === 'test' ? 'Sending…' : 'Send test SMS'}
              </button>
            </div>
          </Panel>
          <Notice tone="info" title="Test send">
            The test goes to every saved number, including while alert texts are off. Save first. A second test soon after may wait on the SMS cooldown.{' '}
            {provider === 'iprogsms'
              ? 'Texts are sent through IPROG SMS to Philippine mobile numbers. Shared sender names reach Globe and DITO; Smart/TNT need your own approved sender name.'
              : provider === 'semaphore'
                ? 'Texts are sent through Semaphore, under the sender name approved on that account, to Philippine mobile numbers.'
                : 'This account sends as Unisoft, which reaches Globe and DITO. Smart, TNT, and Sun numbers are refused.'}
          </Notice>
          {(provider === 'unisms' || provider === 'iprogsms') && filled && phones.some((phone) => phone.trim() && !reachesDefaultSender(phone)) && (
            <Notice tone="warn" title="Network">
              {provider === 'iprogsms'
                ? 'A saved number looks like Smart, TNT, or Sun. IPROG will refuse it until you register a sender name at iprogsms.com/sender-names/new, or use a Globe/DITO number for tests.'
                : 'A saved number uses a Smart, TNT, or Sun prefix. Unisoft will refuse it unless that SIM was moved to Globe or DITO.'}
            </Notice>
          )}
        </div>
      </form>

      {error && <Notice tone="alarm" title="SMS">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {testResults && (
        <Panel title="Test result" bodyClassName="p-0">
          <ul className="divide-y divide-line-soft">
            {testResults.map((result) => (
              <li key={result.recipient} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="num">{result.recipient}</span>
                <StateMark state={result.accepted ? 'ok' : 'alarm'} className="!text-xs">{result.status}</StateMark>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
};

export default DashboardSmsPage;
