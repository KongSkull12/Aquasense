import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { DeviceSelect, KeyValues, MetaItem, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';

interface Device { deviceId: string; name?: string; isActive: boolean }
interface HardwareState {
  deviceId: string;
  online: boolean;
  receivedAt: string | null;
  state: null | { aerator: boolean; automation: boolean; wifiConnected: boolean; mqttConnected: boolean };
}
interface ApiCommand { id: string; action: string; status: 'PENDING' | 'ACKED' | 'EXPIRED'; result?: string | null; expiresAt?: string }
type TrackedCommand = Omit<ApiCommand, 'status'> & { status: ApiCommand['status'] | 'TIMEOUT' };

const DashboardAeratorPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [hardware, setHardware] = useState<HardwareState | null>(null);
  const [trackedCommand, setTrackedCommand] = useState<TrackedCommand | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const refresh = useCallback(async (selectedId = deviceId) => {
    if (!selectedId) return;
    try {
      const response = await apiClient.get<HardwareState & { commands?: ApiCommand[] }>(`/hardware/state?deviceId=${encodeURIComponent(selectedId)}`);
      setHardware(response.data);
      setTrackedCommand((current) => {
        if (!current || current.status !== 'PENDING') return current;
        const updated = response.data.commands?.find((item) => item.id === current.id);
        if (updated && updated.status !== 'PENDING') return { ...current, ...updated };
        if (current.expiresAt && Date.now() >= new Date(current.expiresAt).getTime()) return { ...current, status: 'TIMEOUT' };
        return updated ? { ...current, ...updated } : current;
      });
      setLoadedAt(Date.now());
      setError(null);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to read device state.'));
    }
  }, [deviceId]);

  useEffect(() => {
    let active = true;
    void apiClient.get<Device[]>('/devices').then((response) => {
      if (!active) return;
      const available = (response.data || []).filter((device) => device.isActive);
      setDevices(available);
      setDeviceId((current) => current || available[0]?.deviceId || '');
    }).catch((cause) => { if (active) setError(getApiErrorMessage(cause, 'Unable to load registered devices.')); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    void refresh(deviceId);
    const timer = window.setInterval(() => void refresh(deviceId), 5000);
    return () => window.clearInterval(timer);
  }, [deviceId, refresh]);

  const command = async (action: 'AERATOR_ON' | 'AERATOR_OFF' | 'AERATOR_AUTO') => {
    if (!deviceId || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiClient.post<ApiCommand>('/hardware/commands', { deviceId, action });
      setTrackedCommand(response.data);
      await refresh(deviceId);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Command could not be queued.'));
    } finally {
      setPending(false);
      window.setTimeout(() => void refresh(deviceId), 1200);
    }
  };

  const fresh = hardware?.online === true && loadedAt !== null && Date.now() - loadedAt < 20000;
  const state = hardware?.state;
  const commandStatus: { text: string; state: MarkState } = !trackedCommand ? { text: 'No command sent in this session', state: 'off' }
    : trackedCommand.status === 'PENDING' ? { text: 'Queued, awaiting device acknowledgement', state: 'info' }
      : trackedCommand.status === 'TIMEOUT' ? { text: 'Timed out: no device acknowledgement before the command expired', state: 'warn' }
        : trackedCommand.status === 'EXPIRED' ? { text: 'Expired: the device did not execute this command', state: 'warn' }
          : trackedCommand.result === 'accepted' ? { text: 'Device acknowledged: command accepted', state: 'ok' }
            : { text: `Device rejected: ${trackedCommand.result || 'execution was not accepted'}`, state: 'alarm' };
  const output = fresh && state ? (state.aerator ? 'On' : 'Off') : 'Unknown';
  const mode = fresh && state ? (state.automation ? 'Automatic' : 'Manual') : 'Unknown';

  return <div className="space-y-5">
    <PageHead
      title="Aerator"
      description="Authenticated device control. Output state is the device's logical state, not physical feedback."
      meta={<>
        <MetaItem label="Aerator output"><StateMark state={output === 'On' ? 'ok' : 'off'} className="!text-sm !font-semibold">{output}</StateMark></MetaItem>
        <MetaItem label="Mode">{mode}</MetaItem>
      </>}
    />

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Device state">
        <div className="space-y-4">
          <DeviceSelect id="aerator-device" value={deviceId} devices={devices} onChange={(value) => { setDeviceId(value); setHardware(null); setTrackedCommand(null); }} />
          <KeyValues rows={[
            { label: 'Connection', value: <StateMark state={fresh ? 'ok' : 'off'}>{fresh ? 'Online' : 'Offline or stale'}</StateMark> },
            { label: 'Aerator output (logical)', value: output },
            { label: 'Control mode', value: mode },
            { label: 'Device network', value: fresh && state ? `${state.wifiConnected ? 'Wi-Fi' : 'Wi-Fi disconnected'} · ${state.mqttConnected ? 'MQTT' : 'MQTT disconnected'}` : 'Unknown' },
            { label: 'Last report', value: hardware?.receivedAt ? new Date(hardware.receivedAt).toLocaleString() : 'Not yet reported' },
          ]} />
          <p className="text-[13px] leading-relaxed text-ink-3">Automatic mode applies the firmware temperature policy. It does not use dissolved oxygen, and ORP is never treated as a dissolved-oxygen reading.</p>
        </div>
      </Panel>

      <Panel title="Aerator control" description="On or off switches the device to manual mode. Automatic hands control back to the firmware temperature policy.">
        <div className="space-y-4">
          {/* Only the mode the device reports is shown as selected. */}
          <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Aerator mode">
            {([
              ['AERATOR_ON', 'Turn on', mode === 'Manual' && output === 'On'],
              ['AERATOR_OFF', 'Turn off', mode === 'Manual' && output === 'Off'],
              ['AERATOR_AUTO', 'Automatic', mode === 'Automatic'],
            ] as const).map(([action, label, selected]) => (
              <button
                key={action}
                type="button"
                disabled={!deviceId || pending}
                aria-pressed={selected}
                onClick={() => void command(action)}
                className={`btn-secondary ${selected ? '!border-ink !bg-band' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div aria-live="polite">
            {pending ? <StateMark state="info">Submitting command…</StateMark> : <StateMark state={commandStatus.state}>{commandStatus.text}</StateMark>}
          </div>
          {error && <p role="alert" className="text-[13px] text-alarm">{error}</p>}
          <div className="num space-y-0.5 text-xs text-ink-3">
            {trackedCommand && <p className="break-all">Command {trackedCommand.id} · {trackedCommand.action}</p>}
            {loadedAt && <p>Last state poll {new Date(loadedAt).toLocaleTimeString()}</p>}
          </div>
        </div>
      </Panel>
    </div>
  </div>;
};

export default DashboardAeratorPage;
