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

export const StaffAccountsPanel: React.FC = () => {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      setError(getApiErrorMessage(cause, 'Unable to load staff accounts.'));
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
      await apiClient.post('/staff', { fullName, email, password });
      setFullName('');
      setEmail('');
      setPassword('');
      setMessage('Staff account created. They can sign in and see this farm’s devices.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to create staff account.'));
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      await apiClient.delete(`/staff/${id}`);
      setMessage('Staff account removed.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to remove staff account.'));
    }
  };

  return (
    <Panel
      title="Staff accounts"
      description="Create sign-ins that share this farm’s device readings. Staff can view, feed, and drain or fill — not thresholds, SMS, calibration, or settings."
      actions={message ? <StateMark state="ok">Saved</StateMark> : undefined}
    >
      <form onSubmit={createAccount} className="grid gap-4 md:grid-cols-2">
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
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create staff account'}</button>
        </div>
      </form>

      {error && <p className="mt-4 text-[13px] text-alarm">{error}</p>}
      {message && <p className="mt-4 text-[13px] text-sounding">{message}</p>}

      <div className="mt-6 border-t border-line-soft pt-4">
        <p className="text-[13px] font-medium text-ink-2">Existing staff</p>
        {loading ? (
          <p className="mt-2 text-[13px] text-ink-3">Loading…</p>
        ) : staff.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-3">No staff accounts yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {staff.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-soft px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{account.fullName}</p>
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
