import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { EmptyState, Notice, Panel, StateMark } from './Console';

interface RegisteredDevice {
  deviceId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

const formatRegisteredAt = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Registration date unavailable' : date.toLocaleString();
};

export const DeviceManagement: React.FC = () => {
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadDevices = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get<RegisteredDevice[]>('/devices');
      setDevices(response.data || []);
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, 'Could not load devices registered to this account.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const register = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);
    try {
      await apiClient.post<RegisteredDevice>('/devices', {
        deviceId: deviceId.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setMessage('Device registered and active for this account.');
      setDeviceId('');
      setName('');
      await loadDevices();
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, 'Could not register this device. Check the ID and account ownership.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel
      id="device-management-heading"
      title="Devices"
      description="Register the exact ID set in the firmware running on your AquaSense board. Registering does not check that the board is online."
    >
      <form onSubmit={register} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="field-label" htmlFor="register-device-id">Device ID</label>
          <input id="register-device-id" required minLength={3} maxLength={120} value={deviceId} onChange={(event) => setDeviceId(event.target.value)} disabled={submitting} autoComplete="off" spellCheck={false} className="field" placeholder="Firmware DeviceConfig::DEVICE_ID" />
        </div>
        <div>
          <label className="field-label" htmlFor="register-device-name">Display name <span className="font-normal text-ink-3">(optional)</span></label>
          <input id="register-device-name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} disabled={submitting} className="field" placeholder="e.g. Main tank" />
        </div>
        <button type="submit" disabled={submitting || !deviceId.trim()} className="btn-primary h-10">
          {submitting ? 'Registering…' : 'Register device'}
        </button>
      </form>

      <div className="mt-4 space-y-3">
        {error && <Notice tone="alarm">{error}</Notice>}
        {message && <Notice tone="ok">{message}</Notice>}
      </div>

      <div aria-live="polite" className="mt-4">
        {loading ? <p role="status" className="text-[13px] text-ink-3">Loading registered devices…</p> : devices.length === 0 ? (
          <EmptyState title="No devices registered">TAN entry and device controls become available after you register the ID of your actual device.</EmptyState>
        ) : (
          <ul className="divide-y divide-line-soft border-t border-line-soft">
            {devices.map((device) => (
              <li key={device.deviceId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{device.name || device.deviceId}</p>
                  <p className="num break-all text-xs text-ink-2">{device.deviceId}</p>
                  <p className="text-xs text-ink-3">Registered {formatRegisteredAt(device.createdAt)}</p>
                </div>
                <StateMark state={device.isActive ? 'ok' : 'off'} className="!text-xs">{device.isActive ? 'Active, selectable for TAN' : 'Inactive'}</StateMark>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
};
