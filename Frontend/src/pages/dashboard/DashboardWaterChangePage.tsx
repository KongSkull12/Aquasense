import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { DeviceSelect, EmptyState, KeyValues, MetaItem, Notice, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import { isReadingLive } from '../../components/WaterQuality/sensorDisplay';
import { describeDeviceResult, isAcceptedResult } from '../../components/WaterQuality/deviceResults';
import { bandLabel, classifyBand } from '../../components/WaterQuality/thresholdBands';

interface Device { deviceId: string; name?: string; isActive: boolean }
interface HardwareState {
  deviceId: string;
  online: boolean;
  receivedAt: string | null;
  state: null | {
    fillPump: boolean;
    drainPump: boolean;
    waterPhase: 'IDLE' | 'DRAINING' | 'SETTLING_AFTER_DRAIN' | 'REFILLING' | 'COOLDOWN' | 'COMPLETE' | 'FAULT';
    fault: string;
    automation: boolean;
    phaseRemainingMs?: number;
  };
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

const MAX_DURATION_SECONDS = 600;
const PRESET_SECONDS = [10, 30, 60, 120, 300, 600] as const;

const humanize = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

const formatCountdown = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const phaseLabel = (phase: string | undefined, fillToTarget: boolean): string => {
  if (!phase) return 'Unknown';
  if (phase === 'DRAINING') return 'Draining';
  if (phase === 'REFILLING') return fillToTarget ? 'Filling to target' : 'Filling';
  if (phase === 'SETTLING_AFTER_DRAIN') return 'Settling after drain';
  if (phase === 'COOLDOWN') return 'Cooldown';
  if (phase === 'COMPLETE') return 'Complete';
  if (phase === 'FAULT') return 'Fault';
  return humanize(phase);
};

const WaterChangePage: React.FC = () => {
  const { latestReading, thresholdBands } = useDashboardData();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [hardware, setHardware] = useState<HardwareState | null>(null);
  const [trackedCommand, setTrackedCommand] = useState<TrackedCommand | null>(null);
  const [durationSeconds, setDurationSeconds] = useState('60');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [localCountdown, setLocalCountdown] = useState<{ phase: string; endsAt: number; label: string } | null>(null);

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
    const timer = window.setInterval(() => void refresh(deviceId), 2000);
    return () => window.clearInterval(timer);
  }, [deviceId, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const state = hardware?.state;
  const activePumpPhase = state?.waterPhase === 'DRAINING' || state?.waterPhase === 'REFILLING'
    || state?.waterPhase === 'SETTLING_AFTER_DRAIN' || state?.waterPhase === 'COOLDOWN';

  useEffect(() => {
    if (!state) return;
    const remaining = typeof state.phaseRemainingMs === 'number' ? state.phaseRemainingMs : null;
    if (activePumpPhase && remaining != null && remaining > 0) {
      setLocalCountdown({
        phase: state.waterPhase,
        endsAt: Date.now() + remaining,
        label: phaseLabel(state.waterPhase, trackedCommand?.action === 'FILL_TO_TARGET'),
      });
      return;
    }
    if (!activePumpPhase || state.waterPhase === 'IDLE' || state.waterPhase === 'COMPLETE' || state.waterPhase === 'FAULT') {
      setLocalCountdown(null);
    }
  }, [state?.waterPhase, state?.phaseRemainingMs, state?.fillPump, state?.drainPump, activePumpPhase, trackedCommand?.action]);

  const command = async (action: 'DRAIN' | 'FILL' | 'WATER_EXCHANGE' | 'FILL_TO_TARGET' | 'WATER_STOP') => {
    if (!deviceId || pending) return;
    const needsDuration = action === 'FILL' || action === 'DRAIN' || action === 'WATER_EXCHANGE';
    const seconds = Number(durationSeconds);
    if (needsDuration && (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_DURATION_SECONDS)) {
      setError(`Enter a pump duration from 1 to ${MAX_DURATION_SECONDS} seconds (up to 10 minutes).`);
      return;
    }
    const durationMs = needsDuration ? seconds * 1000 : undefined;
    setPending(true);
    setError(null);
    try {
      const response = await apiClient.post<ApiCommand>('/hardware/commands', { deviceId, action, ...(durationMs ? { durationMs } : {}) });
      setTrackedCommand(response.data);
      if (needsDuration && durationMs) {
        const label = action === 'DRAIN' ? 'Draining' : action === 'FILL' ? 'Filling' : 'Draining';
        setLocalCountdown({ phase: action === 'FILL' ? 'REFILLING' : 'DRAINING', endsAt: Date.now() + durationMs, label });
      } else if (action === 'FILL_TO_TARGET') {
        setLocalCountdown({ phase: 'REFILLING', endsAt: Date.now() + MAX_DURATION_SECONDS * 1000, label: 'Filling to target' });
      } else if (action === 'WATER_STOP') {
        setLocalCountdown(null);
      }
      await refresh(deviceId);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Command could not be queued.'));
    } finally {
      setPending(false);
      window.setTimeout(() => void refresh(deviceId), 1200);
    }
  };

  const fresh = hardware?.online === true && loadedAt !== null && Date.now() - loadedAt < 20000;
  const offlineReason = 'The device must report fresh state before pumps can be started.';
  // The device refuses a new pump run while one (or its 10 s cooldown) is active, so say so up front.
  const pumpBusy = fresh && activePumpPhase;
  const busyReason = 'A pump run or its cooldown is in progress. Press Stop pumps, wait about 10 seconds, then try again.';
  const pumpCommands = hardware?.commands?.filter((item) => ['FILL', 'DRAIN', 'WATER_EXCHANGE', 'FILL_TO_TARGET', 'WATER_STOP', 'AUTOMATION_ON', 'AUTOMATION_OFF'].includes(item.action)) ?? [];
  const stateText = !hardware || !fresh ? 'Offline or stale' : state?.waterPhase ? humanize(state.waterPhase) : 'Unknown';
  const commandStatus: { text: string; state: MarkState } = !trackedCommand ? { text: 'No command sent in this session', state: 'off' }
    : trackedCommand.status === 'PENDING' ? { text: 'Queued, awaiting device acknowledgement', state: 'info' }
      : trackedCommand.status === 'TIMEOUT' ? { text: 'Timed out: no device acknowledgement before the command expired', state: 'warn' }
        : trackedCommand.status === 'EXPIRED' ? { text: 'Expired: the device did not execute this command', state: 'warn' }
          : trackedCommand.result === 'accepted' ? { text: 'Device acknowledged: command accepted', state: 'ok' }
            : { text: `Device rejected: ${describeDeviceResult(trackedCommand.result)}`, state: 'alarm' };

  const live = isReadingLive(latestReading);
  const tank = latestReading?.tankLevel ?? latestReading?.sensorHealth?.ultrasonic ?? null;
  const depthLive = live && !!tank?.valid && tank.depthCm != null;
  const levelLive = live && !!tank?.valid && tank.levelPercent != null;
  const targetDepthCm = tank?.targetDepthCm != null && Number.isFinite(tank.targetDepthCm)
    ? tank.targetDepthCm
    : thresholdBands.waterDepth.normalMin != null && thresholdBands.waterDepth.normalMax != null
      ? (thresholdBands.waterDepth.normalMin + thresholdBands.waterDepth.normalMax) / 2
      : 3;
  const lostCm = depthLive ? Math.max(0, targetDepthCm - tank!.depthCm!) : null;
  const depthBand = depthLive ? bandLabel(classifyBand(tank!.depthCm!, thresholdBands.waterDepth)) : null;
  const levelState: MarkState = depthLive
    ? (depthBand === 'Normal' ? 'ok' : depthBand === 'Warning' ? 'warn' : 'alarm')
    : levelLive ? 'ok' : live && tank ? 'warn' : 'off';
  const levelStatus = depthLive && depthBand ? depthBand : levelLive ? 'Live' : live && tank ? (tank.reason || 'No valid echo') : 'No live data';
  const fillToTargetReady = fresh && depthLive && (lostCm == null || lostCm > 0.05);

  const deviceRemainingMs = typeof state?.phaseRemainingMs === 'number' && activePumpPhase ? state.phaseRemainingMs : null;
  const localRemainingMs = localCountdown ? Math.max(0, localCountdown.endsAt - nowTick) : null;
  const countdownMs = deviceRemainingMs ?? localRemainingMs;
  const countdownActive = countdownMs != null && countdownMs > 0 && (activePumpPhase || !!localCountdown);
  const countdownLabel = localCountdown?.label
    || phaseLabel(state?.waterPhase, trackedCommand?.action === 'FILL_TO_TARGET');
  const countdownProgress = (() => {
    if (!countdownActive || countdownMs == null) return 0;
    const total = trackedCommand?.durationMs
      || (Number(durationSeconds) > 0 ? Number(durationSeconds) * 1000 : MAX_DURATION_SECONDS * 1000);
    return Math.min(100, Math.max(0, ((total - countdownMs) / total) * 100));
  })();

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
          <DeviceSelect id="water-device" value={deviceId} devices={devices} onChange={(value) => { setDeviceId(value); setHardware(null); setTrackedCommand(null); setLocalCountdown(null); }} />
          <KeyValues rows={[
            { label: 'Drain output (logical)', value: fresh && state ? (state.drainPump ? 'On' : 'Off') : 'Unknown' },
            { label: 'Fill output (logical)', value: fresh && state ? (state.fillPump ? 'On' : 'Off') : 'Unknown' },
            { label: 'Automation', value: state?.automation ? 'On (old firmware): press Stop pumps, then flash the latest' : 'Removed: pumps run only when you press a button' },
            { label: 'Last report', value: hardware?.receivedAt ? new Date(hardware.receivedAt).toLocaleString() : 'Not yet reported' },
          ]} />
          {state?.fault && <Notice tone="alarm" title="Device fault">{state.fault}</Notice>}
          <p className="text-[13px] leading-relaxed text-ink-3">The device firmware owns automatic water-change decisions. Predictive risk on this page does not start pumps.</p>
        </div>
      </Panel>

      <Panel title="Manual water control" description="Set any duration from 1 to 600 seconds. Drain and fill run for that long. Run exchange drains, then fills, for the same duration each. Fill to target stops near the calibrated depth.">
        <div className="space-y-4">
          <div>
            <label className="field-label" htmlFor="pump-duration">Duration in seconds</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="pump-duration"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_DURATION_SECONDS}
                step={1}
                value={durationSeconds}
                onChange={(event) => setDurationSeconds(event.target.value)}
                placeholder={`1–${MAX_DURATION_SECONDS}`}
                className="field num max-w-[160px]"
              />
              <div className="flex flex-wrap gap-1.5">
                {PRESET_SECONDS.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    onClick={() => setDurationSeconds(String(seconds))}
                    aria-pressed={durationSeconds === String(seconds)}
                    className={`btn-secondary btn-sm num ${durationSeconds === String(seconds) ? '!border-ink !bg-band' : ''}`}
                  >
                    {seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}
                  </button>
                ))}
              </div>
            </div>
            <p className="field-hint">Choose any value from 1 to {MAX_DURATION_SECONDS} s (10 minutes). Fill to target does not need a duration; it stops at the target depth or at the 10-minute safety ceiling.</p>
          </div>

          {(countdownActive || activePumpPhase) && (
            <div className="rounded-md border border-line bg-water px-4 py-3" aria-live="polite">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[13px] text-ink-3">{countdownLabel}</p>
                  <p className="num mt-0.5 text-3xl font-semibold tracking-tight">
                    {countdownActive && countdownMs != null ? formatCountdown(countdownMs) : '—'}
                  </p>
                </div>
                <StateMark state={state?.waterPhase === 'FAULT' ? 'alarm' : 'info'}>
                  {fresh && state ? phaseLabel(state.waterPhase, trackedCommand?.action === 'FILL_TO_TARGET') : 'Waiting for device'}
                </StateMark>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-soft">
                <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${countdownProgress}%` }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!deviceId || pending || !fresh || pumpBusy} title={!fresh ? offlineReason : pumpBusy ? busyReason : undefined} onClick={() => void command('DRAIN')} className="btn-secondary">Drain</button>
            <button type="button" disabled={!deviceId || pending || !fresh || pumpBusy} title={!fresh ? offlineReason : pumpBusy ? busyReason : undefined} onClick={() => void command('FILL')} className="btn-secondary">Fill</button>
            <button type="button" disabled={!deviceId || pending || !fresh || pumpBusy} title={!fresh ? offlineReason : pumpBusy ? busyReason : undefined} onClick={() => void command('WATER_EXCHANGE')} className="btn-primary">Run exchange</button>
            <button type="button" disabled={!deviceId || pending || !fillToTargetReady || pumpBusy} title={!fresh ? offlineReason : pumpBusy ? busyReason : !depthLive ? 'Calibrate tank depth first and wait for a live depth reading.' : lostCm != null && lostCm <= 0.05 ? 'Already at or above the target depth.' : undefined} onClick={() => void command('FILL_TO_TARGET')} className="btn-secondary">Fill to target</button>
            <button type="button" disabled={!deviceId || pending} onClick={() => void command('WATER_STOP')} className="btn-danger col-span-2">Stop pumps</button>
          </div>
          {!fresh && <Notice tone="info">Drain, fill and exchange stay disabled until the device reports fresh state. Stop is always available.</Notice>}
          {pumpBusy && <Notice tone="info">{state ? phaseLabel(state.waterPhase, trackedCommand?.action === 'FILL_TO_TARGET') : 'A pump run'} is in progress, so Drain, Fill and Run exchange are paused. {busyReason}</Notice>}
          {!depthLive && fresh && <Notice tone="info">Fill to target needs a calibrated mount height (Calibration → Tank) and a live depth reading.</Notice>}
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

    <Panel
      title="Water level"
      id="water-level-heading"
      actions={<StateMark state={levelState}>{levelStatus}</StateMark>}
      description="Depth is mount height minus ultrasonic distance. Capture the empty tub on Calibration, then set the target depth."
    >
      <div className="grid gap-px overflow-hidden rounded-md border border-line-soft bg-line-soft sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Water depth', depthLive ? `${tank!.depthCm!.toFixed(2)} cm` : '—'],
          ['Lost vs target', lostCm != null ? `${lostCm.toFixed(2)} cm` : '—'],
          ['Distance to water', levelLive && tank?.distanceCm != null ? `${tank.distanceCm.toFixed(1)} cm` : '—'],
          ['Fill to target', depthLive ? (lostCm != null && lostCm > 0.05 ? 'Ready (manual)' : 'At target') : 'Needs calibration'],
        ].map(([label, value]) => (
          <div key={label} className="bg-white px-4 py-3">
            <p className="text-[13px] text-ink-3">{label}</p>
            <p className="num mt-0.5 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
        Device target is {targetDepthCm.toFixed(1)} cm{tank?.targetDepthCm != null ? '' : ' (from Thresholds Normal midpoint until the device reports a calibrated target)'}. Press Fill to target to restore lost depth; the device never fills or drains by itself. The pump stops at the device target depth, on a bad echo, or at the 10-minute safety ceiling.
      </p>
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
                  <td className={`px-5 py-2.5 ${item.result && !isAcceptedResult(item.result) ? 'text-alarm' : 'text-ink-2'}`}>{describeDeviceResult(item.result)}</td>
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
