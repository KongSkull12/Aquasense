import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import { isReadingLive } from '../../components/WaterQuality/sensorDisplay';
import { describeDeviceResult } from '../../components/WaterQuality/deviceResults';
import { DeviceSelect, EmptyState, MetaItem, Notice, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';

interface Device { deviceId: string; name?: string; isActive: boolean }
interface ApiCommand { id: string; action: string; param?: string | null; status: 'PENDING' | 'ACKED' | 'EXPIRED'; result?: string | null; createdAt?: string }
interface HardwareState { online: boolean; receivedAt: string | null; commands?: ApiCommand[] }
type SensorKey = 'ph' | 'turb' | 'orp';
type CalAction = 'CAL_CAPTURE' | 'CAL_STATUS' | 'CAL_CLEAR' | 'CAL_RESET';

const SENSORS: Array<{
  key: SensorKey; health: 'ph' | 'turbidity' | 'orp'; title: string; input: 'voltage' | 'rawAdc'; inputUnit: string;
  steadyWithin: number; refLabel: string; refUnit: string; min: number; max: number; presets: number[]; steps: string[]; hint?: string;
}> = [
  {
    key: 'ph', health: 'ph', title: 'pH', input: 'voltage', inputUnit: 'V', steadyWithin: 0.01,
    refLabel: 'Buffer value', refUnit: 'pH', min: 0, max: 14, presets: [6.86, 4.01, 9.18],
    steps: ['Rinse the probe with distilled water and blot it dry.', 'Put it in the 6.86 buffer, wait for Steady, then capture.', 'Repeat with 4.01, then 9.18. Two points save a calibration; the third refines it.'],
    hint: 'Buffer values are for 25 °C. At 30 °C use 6.85, 4.01 and 9.14 (or the table on your sachet).',
  },
  {
    key: 'turb', health: 'turbidity', title: 'Turbidity', input: 'rawAdc', inputUnit: 'ADC', steadyWithin: 30,
    refLabel: 'Standard', refUnit: 'NTU', min: 0, max: 3000, presets: [0],
    steps: ['Put the sensor in clear water, wait for Steady, and capture 0 NTU.', 'Put it in a known standard (e.g. 100 NTU), wait, and capture that value.'],
  },
  {
    key: 'orp', health: 'orp', title: 'ORP / redox', input: 'voltage', inputUnit: 'V', steadyWithin: 0.01,
    refLabel: 'Standard', refUnit: 'mV', min: -2000, max: 2000, presets: [],
    steps: ['Put the probe in an ORP standard solution and wait for Steady.', 'Enter the mV value printed on the solution and capture. One point corrects the offset; a second standard fits the slope too.'],
  },
];

const parseResult = (sensor: SensorKey, result?: string | null): { state: MarkState; text: string } => {
  if (!result) return { state: 'off', text: 'No result reported' };
  const num = (key: string) => { const m = result.match(new RegExp(`${key}=(-?[\\d.]+)`)); return m ? Number(m[1]) : null; };
  const n = num('n'); const slope = num('slope'); const offset = num('offset');
  const line = slope !== null && offset !== null
    ? `slope ${slope}, offset ${offset}${sensor === 'ph' && slope !== 0 ? ` (${(1000 / Math.abs(slope)).toFixed(1)} mV per pH)` : ''}`
    : '';
  if (result.startsWith('saved')) return { state: 'ok', text: `Saved on the device, fitted from ${n} point${n === 1 ? '' : 's'}: ${line}.` };
  if (result.startsWith('recorded')) return { state: 'info', text: `Point 1 recorded (input ${num('x')}). Capture a second reference to finish.` };
  if (result.startsWith('status')) return { state: 'info', text: `Saved calibration: ${line}. ${n} point${n === 1 ? '' : 's'} captured since the device started.` };
  if (result.startsWith('reset')) return { state: 'ok', text: `Reset to the default calibration and saved: ${line}.` };
  if (result === 'cleared') return { state: 'info', text: 'Captured points cleared. The saved calibration is unchanged.' };
  return { state: 'alarm', text: describeDeviceResult(result) };
};

const sensorOfParam = (param?: string | null): SensorKey | null => {
  const key = (param || '').split(':')[0];
  return key === 'ph' || key === 'turb' || key === 'orp' ? key : null;
};

const actionLabel: Record<CalAction, string> = { CAL_CAPTURE: 'Capture', CAL_STATUS: 'Read calibration', CAL_CLEAR: 'Clear points', CAL_RESET: 'Reset' };

const DashboardCalibrationPage: React.FC = () => {
  const { latestReading } = useDashboardData();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [hardware, setHardware] = useState<HardwareState | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [references, setReferences] = useState<Record<SensorKey, string>>({ ph: '6.86', turb: '0', orp: '' });
  const [sending, setSending] = useState<SensorKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<Partial<Record<SensorKey, string>>>({});
  const recentInputs = useRef<Record<SensorKey, number[]>>({ ph: [], turb: [], orp: [] });
  const lastFrame = useRef<string | null>(null);

  const refresh = useCallback(async (selectedId = deviceId) => {
    if (!selectedId) return;
    try {
      const response = await apiClient.get<HardwareState>(`/hardware/state?deviceId=${encodeURIComponent(selectedId)}`);
      setHardware(response.data);
      setLoadedAt(Date.now());
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

  const commands = (hardware?.commands ?? []).filter((item) => item.action.startsWith('CAL_'));
  const pending = commands.some((item) => item.status === 'PENDING');

  // Poll faster while a calibration command is waiting for the device.
  useEffect(() => {
    if (!deviceId) return;
    void refresh(deviceId);
    const timer = window.setInterval(() => void refresh(deviceId), pending || sending ? 2000 : 5000);
    return () => window.clearInterval(timer);
  }, [deviceId, refresh, pending, sending]);

  // Keep the last few live inputs per sensor to judge whether the probe has settled.
  const live = isReadingLive(latestReading);
  useEffect(() => {
    const stamp = latestReading?.timestamp ? String(latestReading.timestamp) : null;
    if (!live || !stamp || stamp === lastFrame.current) return;
    lastFrame.current = stamp;
    for (const sensor of SENSORS) {
      const health = latestReading?.sensorHealth?.[sensor.health];
      const x = health ? health[sensor.input] : null;
      const list = recentInputs.current[sensor.key];
      if (typeof x === 'number' && Number.isFinite(x)) { list.push(x); if (list.length > 4) list.shift(); }
      else list.length = 0;
    }
  }, [latestReading, live]);

  const fresh = (hardware?.online === true && loadedAt !== null && Date.now() - loadedAt < 20000) || live;

  const send = async (sensor: SensorKey, action: CalAction) => {
    if (!deviceId) return;
    let param: string = sensor;
    if (action === 'CAL_CAPTURE') {
      const config = SENSORS.find((item) => item.key === sensor)!;
      const value = Number(references[sensor]);
      if (references[sensor].trim() === '' || !Number.isFinite(value) || value < config.min || value > config.max) {
        setError(`Enter a ${config.refLabel.toLowerCase()} between ${config.min} and ${config.max}${config.refUnit ? ` ${config.refUnit}` : ''}.`);
        return;
      }
      param = `${sensor}:${Number(value.toFixed(3))}`;
    }
    if (action === 'CAL_RESET' && !window.confirm('Reset this sensor to the default calibration? The saved calibration on the device will be replaced.')) return;
    setSending(sensor);
    setError(null);
    try {
      const response = await apiClient.post<ApiCommand>('/hardware/commands', { deviceId, action, param });
      setLastCommand((current) => ({ ...current, [sensor]: response.data.id }));
      await refresh(deviceId);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Calibration command could not be sent.'));
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHead
        title="Calibration"
        description="Calibrate pH, turbidity and ORP against reference solutions. The device averages 3 seconds of readings for each point, fits a line once it has two, and saves it on the device."
        meta={<MetaItem label="Device"><StateMark state={fresh ? 'ok' : 'off'} className="!text-sm !font-semibold">{fresh ? 'Online' : 'Offline or stale'}</StateMark></MetaItem>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Panel title="Device">
          <DeviceSelect id="calibration-device" value={deviceId} devices={devices} onChange={(value) => { setDeviceId(value); setHardware(null); setLastCommand({}); }} />
        </Panel>
        <Notice tone="info" title="Before you start">
          A saved capture is stored on the ESP32 and recorded by the server, so the dashboard can classify that sensor. Temperature (DS18B20) is factory calibrated and does not need a capture. Resetting a sensor clears that record.
        </Notice>
      </div>

      {!fresh && <Notice tone="warn" title="Device not reporting">Captures need live readings. Check that the ESP32 is powered and connected, then come back.</Notice>}
      {error && <Notice tone="alarm">{error}</Notice>}

      <div className="grid gap-4 xl:grid-cols-3">
        {SENSORS.map((sensor) => {
          const health = live ? latestReading?.sensorHealth?.[sensor.health] : undefined;
          const input = health ? health[sensor.input] : null;
          const reading = !live ? null : sensor.key === 'ph' ? latestReading?.ph : sensor.key === 'turb' ? (latestReading?.turbidityUnit === 'NTU' ? latestReading?.turbidity : null) : latestReading?.orp;
          const samples = recentInputs.current[sensor.key];
          const spread = samples.length >= 3 ? Math.max(...samples) - Math.min(...samples) : null;
          const steady = spread !== null && spread <= sensor.steadyWithin;
          const settle: { state: MarkState; text: string } = !live || input == null ? { state: 'off', text: 'No live input' }
            : spread === null ? { state: 'info', text: 'Measuring…' }
              : steady ? { state: 'ok', text: 'Steady' } : { state: 'warn', text: 'Settling' };

          const tracked = commands.find((item) => item.id === lastCommand[sensor.key])
            ?? commands.find((item) => sensorOfParam(item.param) === sensor.key);
          const trackedPending = tracked?.status === 'PENDING';
          const outcome = !tracked ? null
            : tracked.status === 'PENDING' ? { state: 'info' as MarkState, text: tracked.action === 'CAL_CAPTURE' ? 'Sent. The device is sampling for 3 seconds…' : 'Sent, waiting for the device…' }
              : tracked.status === 'EXPIRED' ? { state: 'warn' as MarkState, text: 'The device did not answer before the command expired. Check that it is online.' }
                : parseResult(sensor.key, tracked.result);
          const busy = sending === sensor.key || trackedPending;

          return (
            <Panel
              key={sensor.key}
              title={sensor.title}
              actions={<StateMark state={settle.state}>{settle.text}</StateMark>}
              bodyClassName="flex flex-col gap-4 p-4 sm:p-5"
            >
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-soft bg-line-soft">
                <div className="bg-white px-3.5 py-3">
                  <p className="text-xs text-ink-3">Probe input</p>
                  <p className="num mt-0.5 text-xl font-semibold">{input == null ? '—' : sensor.input === 'voltage' ? input.toFixed(4) : Math.round(input)}<span className="ml-1 text-xs font-medium text-ink-3">{sensor.inputUnit}</span></p>
                </div>
                <div className="bg-white px-3.5 py-3">
                  <p className="text-xs text-ink-3">Current reading</p>
                  <p className="num mt-0.5 text-xl font-semibold">{reading == null ? '—' : reading.toFixed(sensor.key === 'ph' ? 2 : 1)}<span className="ml-1 text-xs font-medium text-ink-3">{sensor.key === 'ph' ? '' : sensor.refUnit}</span></p>
                </div>
              </div>

              <ol className="list-decimal space-y-1 pl-4 text-[13px] leading-relaxed text-ink-2">
                {sensor.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              {sensor.hint && <p className="-mt-2 text-xs leading-relaxed text-ink-3">{sensor.hint}</p>}

              <form onSubmit={(event) => { event.preventDefault(); void send(sensor.key, 'CAL_CAPTURE'); }} className="space-y-2.5">
                <label className="field-label !mb-0" htmlFor={`ref-${sensor.key}`}>{sensor.refLabel}{sensor.refUnit ? ` (${sensor.refUnit})` : ''}</label>
                {sensor.presets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sensor.presets.map((preset) => (
                      <button key={preset} type="button" onClick={() => setReferences((current) => ({ ...current, [sensor.key]: String(preset) }))}
                        aria-pressed={references[sensor.key] === String(preset)}
                        className={`btn-secondary btn-sm num ${references[sensor.key] === String(preset) ? '!border-ink !bg-band' : ''}`}>
                        {preset}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input id={`ref-${sensor.key}`} type="number" inputMode="decimal" step="any" min={sensor.min} max={sensor.max}
                    value={references[sensor.key]} onChange={(event) => setReferences((current) => ({ ...current, [sensor.key]: event.target.value }))}
                    placeholder={sensor.key === 'orp' ? 'e.g. 225' : ''} className="field num min-w-0 flex-1" />
                  <button type="submit" disabled={!deviceId || !fresh || busy} className="btn-primary h-10 shrink-0">
                    {busy ? 'Capturing…' : 'Capture point'}
                  </button>
                </div>
              </form>

              <div aria-live="polite" className="min-h-[1.25rem]">
                {outcome && <StateMark state={outcome.state}>{outcome.text}</StateMark>}
              </div>

              <div className="mt-auto flex flex-wrap gap-1 border-t border-line-soft pt-3">
                <button type="button" disabled={!deviceId || !fresh || busy} onClick={() => void send(sensor.key, 'CAL_STATUS')} className="btn-quiet btn-sm">Read saved calibration</button>
                <button type="button" disabled={!deviceId || !fresh || busy} onClick={() => void send(sensor.key, 'CAL_CLEAR')} className="btn-quiet btn-sm">Clear points</button>
                <button type="button" disabled={!deviceId || !fresh || busy} onClick={() => void send(sensor.key, 'CAL_RESET')} className="btn-quiet btn-sm !text-alarm hover:!bg-alarm-bg">Reset to default</button>
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel title="Calibration history" description="Recent calibration commands for this device and what the device answered." bodyClassName="p-0">
        {commands.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-3">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Time</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Sensor</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Action</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-line-soft">
                {commands.map((item) => {
                  const sensor = sensorOfParam(item.param);
                  const reference = item.param?.includes(':') ? item.param.split(':')[1] : null;
                  const parsed = item.status === 'PENDING' ? { state: 'info' as MarkState, text: 'Waiting for the device' }
                    : item.status === 'EXPIRED' ? { state: 'warn' as MarkState, text: 'No answer before expiry' }
                      : parseResult(sensor ?? 'ph', item.result);
                  return (
                    <tr key={item.id} className="align-top hover:bg-water">
                      <td className="whitespace-nowrap px-5 py-2.5 text-ink-2">{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2.5">{SENSORS.find((s) => s.key === sensor)?.title ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{actionLabel[item.action as CalAction] ?? item.action}{reference ? ` ${reference}` : ''}</td>
                      <td className="px-5 py-2.5"><StateMark state={parsed.state} className="!text-[13px]">{parsed.text}</StateMark></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5"><EmptyState title="No calibration yet">Captured points and their results will be listed here.</EmptyState></div>
        )}
      </Panel>
    </div>
  );
};

export default DashboardCalibrationPage;
