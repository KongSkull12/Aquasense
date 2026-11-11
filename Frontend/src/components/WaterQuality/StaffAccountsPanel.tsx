import React, { useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { Panel, StateMark } from './Console';

type StaffUser = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  createdAt?: string;
};

type Access = 'viewer' | 'staff';

const ACCESS_OPTIONS: Array<{ value: Access; label: string; text: string }> = [
  { value: 'viewer', label: 'Viewer', text: 'Sees readings, charts and alerts only. Cannot feed, run pumps or change anything.' },
  { value: 'staff', label: 'Staff', text: 'Also feeds, drains or fills the tank, and switches the aerator. Cannot change thresholds, SMS, calibration or settings.' },
];

/** Viewers are stored as the read-only `guest` role. */
const accessOf = (role: string): Access => (role === 'guest' ? 'viewer' : 'staff');

export const StaffAccountsPanel: React.FC = () => {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [access, setAccess] = useState<Access>('viewer');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<StaffUser[]>('/staff');
      setStaff(response.data || []);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load accounts.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.post('/staff', { fullName, email, password, access });
      setFullName('');
      setEmail('');
      setPassword('');
      setMessage(access === 'viewer'
        ? 'Viewer account created. They can sign in and see this farm’s readings and alerts.'
        : 'Staff account created. They can sign in, see readings, feed, drain or fill, and switch the aerator.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to create the account.'));
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      await apiClient.delete(`/staff/${id}`);
      setMessage('Account removed.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to remove the account.'));
    }
  };

  return (
    <Panel
      title="Staff and viewer accounts"
      description="Create sign-ins for other people that share this farm’s device. A viewer can only look at the readings."
      actions={message ? <StateMark state="ok">Saved</StateMark> : undefined}
    >
      <form onSubmit={createAccount} className="grid gap-4 md:grid-cols-2">
        <fieldset className="md:col-span-2">
          <legend className="field-label">Account type</legend>
          <div className="mt-1 flex flex-wrap gap-2" role="radiogroup">
            {ACCESS_OPTIONS.map((option) => (
              <label key={option.value} className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${access === option.value ? 'border-ink bg-water font-semibold' : 'border-line'}`}>
                <input type="radio" name="staff-access" value={option.value} checked={access === option.value}
                  onChange={() => setAccess(option.value)} className="sr-only" />
                {option.label}
              </label>
            ))}
          </div>
          <p className="field-hint">{ACCESS_OPTIONS.find((option) => option.value === access)?.text}</p>
        </fieldset>
        <div>
          <label className="field-label" htmlFor="staff-name">Full name</label>
          <input id="staff-name" required value={fullName} onChange={(event) => setFullName(event.target.value)} className="field" />
        </div>
        <div>
          <label className="field-label" htmlFor="staff-email">Email</label>
          <input id="staff-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="field" />
        </div>
        <div className="md:col-span-2">
          <label className="field-label" htmlFor="staff-password">Temporary password</label>
          <input id="staff-password" type="password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} className="field" autoComplete="new-password" />
          <p className="field-hint">At least 12 characters with upper, lower, number, and special character.</p>
        </div>
        <div className="md:col-span-2 flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Creating…' : access === 'viewer' ? 'Create viewer account' : 'Create staff account'}</button>
        </div>
      </form>

      {error && <p className="mt-4 text-[13px] text-alarm">{error}</p>}
      {message && <p className="mt-4 text-[13px] text-sounding">{message}</p>}

      <div className="mt-6 border-t border-line-soft pt-4">
        <p className="text-[13px] font-medium text-ink-2">Existing accounts</p>
        {loading ? (
          <p className="mt-2 text-[13px] text-ink-3">Loading…</p>
        ) : staff.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-3">No staff or viewer accounts yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {staff.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-soft px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">
                    {account.fullName}
                    <span className="ml-2 rounded border border-line-soft px-1.5 py-0.5 text-[11px] font-medium text-ink-3">
                      {accessOf(account.role) === 'viewer' ? 'Viewer' : 'Staff'}
                    </span>
                  </p>
                  <p className="truncate text-[12px] text-ink-3">{account.email}</p>
                </div>
                <button type="button" className="btn-secondary" onClick={() => void removeAccount(account.id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
};
