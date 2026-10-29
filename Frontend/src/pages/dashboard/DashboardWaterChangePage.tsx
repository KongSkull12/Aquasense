import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { DeviceSelect, EmptyState, KeyValues, MetaItem, Notice, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';

interface Device { deviceId: string; name?: string; isActive: boolean }
interface HardwareState {
  deviceId: string;
  online: boolean;
  receivedAt: string | null;
  state: null | { fillPump: boolean; drainPump: boolean; waterPhase: 'IDLE' | 'DRAINING' | 'SETTLING_AFTER_DRAIN' | 'REFILLING' | 'COOLDOWN' | 'COMPLETE' | 'FAULT'; fault: string; automation: boolean };
  commands?: ApiCommand[];
}
interface ApiCommand {
  id: string;
  action: string;
  status: 'PENDING' | 'ACKED' | 'EXPIRED';
  result?: string | null;
  durationMs?: number | null;
  expiresAt?: string;
  createdAt?: string;
}
type TrackedCommand = Omit<ApiCommand, 'status'> & { status: ApiCommand['status'] | 'TIMEOUT' };

const humanize = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

const WaterChangePage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [hardware, setHardware] = useState<HardwareState | null>(null);
  const [trackedCommand, setTrackedCommand] = useState<TrackedCommand | null>(null);
  const [durationSeconds, setDurationSeconds] = useState('');
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

  const command = async (action: 'DRAIN' | 'FILL' | 'WATER_EXCHANGE' | 'WATER_STOP') => {
    if (!deviceId || pending) return;
    const durationMs = action === 'WATER_STOP' ? undefined : Number(durationSeconds) * 1000;
    const seconds = Number(durationSeconds);
    if (action !== 'WATER_STOP' && (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)) {
      setError('Enter a pump duration from 1 to 60 seconds.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await apiClient.post<ApiCommand>('/hardware/commands', { deviceId, action, ...(durationMs ? { durationMs } : {}) });
      setTrackedCommand(response.data);
      await refresh(deviceId);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Command could not be queued.'));
    } finally {
      setPending(false);
      window.setTimeout(() => void refresh(deviceId), 1200);
    }
  };

  const state = hardware?.state;
  const fresh = hardware?.online === true && loadedAt !== null && Date.now() - loadedAt < 20000;
  const offlineReason = 'The device must report fresh state before pumps can be started.';
  const pumpCommands =hardware?.commands?.filter((item) => ['FILL', 'DRAIN', 'WATER_EXCHANGE', 'WATER_STOP'].includes(item.action)) ?? [];
  const stateText = !hardware || !fresh ? 'Offline or stale' : state?.waterPhase ? humanize(state.waterPhase) : 'Unknown';
  const commandStatus: { text: string; state: MarkState } = !trackedCommand ? { text: 'No command sent in this session', state: 'off' }
    : trackedCommand.status === 'PENDING' ? { text: 'Queued, awaiting device acknowledgement', state: 'info' }
      : trackedCommand.status === 'TIMEOUT' ? { text: 'Timed out: no device acknowledgement before the command expired', state: 'warn' }
        : trackedCommand.status === 'EXPIRED' ? { text: 'Expired: the device did not execute this command', state: 'warn' }
          : trackedCommand.result === 'accepted' ? { text: 'Device acknowledged: command accepted', state: 'ok' }
            : { text: `Device rejected: ${trackedCommand.result || 'execution was not accepted'}`, state: 'alarm' };

  return <div className="space-y-5">
    <PageHead
      title="Water change"
      description="Timed pump commands through the authenticated device API. Output state is the device's logical state, not physical feedback."
      meta={<>
        <MetaItem label="Device"><StateMark state={fresh ? 'ok' : 'off'} className="!text-sm !font-semibold">{fresh ? 'Online' : 'Offline or stale'}</StateMark></MetaItem>
        <MetaItem label="Water phase">{state?.waterPhase === 'FAULT' ? <span className="text-alarm">{stateText}</span> : stateText}</MetaItem>
      </>}
    />

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Device state">
        <div className="space-y-4">
          <DeviceSelect id="water-device" value={deviceId} devices={devices} onChange={(value) => { setDeviceId(value); setHardware(null); setTrackedCommand(null); }} />
          <KeyValues rows={[
            { label: 'Drain output (logical)', value: fresh && state ? (state.drainPump ? 'On' : 'Off') : 'Unknown' },
            { label: 'Fill output (logical)', value: fresh && state ? (state.fillPump ? 'On' : 'Off') : 'Unknown' },
            { label: 'Automation', value: state?.automation ? 'Enabled on device' : 'Disabled on device' },
            { label: 'Last report', value: hardware?.receivedAt ? new Date(hardware.receivedAt).toLocaleString() : 'Not yet reported' },
          ]} />
          {state?.fault && <Notice tone="alarm" title="Device fault">{state.fault}</Notice>}
          <p className="text-[13px] leading-relaxed text-ink-3">The device firmware owns automatic water-change decisions. Predictive risk on this page does not start pumps.</p>
        </div>
      </Panel>

      <Panel title="Manual water control" description="Pump controls stay fail-closed until timing and relay settings are commissioned.">
        <div className="space-y-4">
          <div>
            <label className="field-label" htmlFor="pump-duration">Duration in seconds</label>
            <input id="pump-duration" type="number" inputMode="numeric" min="1" max="60" step="1" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} placeholder="1–60" className="field num max-w-[160px]" />
            <p className="field-hint">Required by the API. Drain and fill are capped at 60 s and the commissioned pump target. Exchange uses its own commissioned drain and fill targets.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!deviceId || pending || !fresh} title={!fresh ? offlineReason : undefined} onClick={() => void command('DRAIN')} className="btn-secondary">Drain</button>
            <button type="button" disabled={!deviceId || pending || !fresh} title={!fresh ? offlineReason : undefined} onClick={() => void command('FILL')} className="btn-secondary">Fill</button>
            <button type="button" disabled={!deviceId || pending || !fresh} title={!fresh ? offlineReason : undefined} onClick={() => void command('WATER_EXCHANGE')} className="btn-primary">Run exchange</button>
            <button type="button" disabled={!deviceId || pending} onClick={() => void command('WATER_STOP')} className="btn-danger">Stop pumps</button>
          </div>
          {!fresh && <Notice tone="info">Drain, fill and exchange stay disabled until the device reports fresh state. Stop is always available.</Notice>}
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

    <Panel title="Water level" id="water-level-heading" actions={<StateMark state="off">Unavailable</StateMark>} description="Ultrasonic level sensing is not installed or commissioned for this device.">
      <div className="grid gap-px overflow-hidden rounded-md border border-line-soft bg-line-soft sm:grid-cols-3">
        {[['Measured level', 'Unavailable'], ['Estimated volume', 'Unavailable'], ['Level-based pump automation', 'Disabled']].map(([label, value]) => (
          <div key={label} className="bg-white px-4 py-3">
            <p className="text-[13px] text-ink-3">{label}</p>
            <p className="mt-0.5 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">No level percentage, pond capacity, or exchange volume is estimated. Sensor model, wiring, and tank calibration must be confirmed before these values or level-based automation can be enabled.</p>
    </Panel>

    <Panel title="Recent pump commands" id="pump-history-heading" description="Attempts and device acknowledgements. An acknowledgement does not confirm water flowed or an exchange finished." bodyClassName="p-0">
      {pumpCommands.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Requested</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Command</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Duration</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-5 py-2.5 font-medium">Device result</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line-soft">
              {pumpCommands.map((item) => (
                <tr key={item.id} className="hover:bg-water">
                  <td className="px-5 py-2.5 text-ink-2">{item.createdAt && Number.isFinite(new Date(item.createdAt).getTime()) ? new Date(item.createdAt).toLocaleString() : 'Time unavailable'}</td>
                  <td className="px-3 py-2.5 font-medium">{humanize(item.action)}</td>
                  <td className="px-3 py-2.5 text-right">{item.durationMs == null ? '—' : `${(item.durationMs / 1000).toFixed(1)} s`}</td>
                  <td className="px-3 py-2.5">{humanize(item.status)}</td>
                  <td className="px-5 py-2.5 text-ink-2">{item.result || 'No result reported'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="p-5"><EmptyState title={hardware ? 'No pump commands yet' : 'No device state loaded'}>{hardware ? 'Commands you send above are recorded here with the device acknowledgement.' : 'Select a device to load its state and command history.'}</EmptyState></div>}
    </Panel>
  </div>;
};

export default WaterChangePage;
