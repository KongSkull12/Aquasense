import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import { isReadingLive } from '../../components/WaterQuality/sensorDisplay';
import { describeDeviceResult } from '../../components/WaterQuality/deviceResults';
import { DeviceSelect, EmptyState, MetaItem, Notice, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';

interface Device { deviceId: string; name?: string; isActive: boolean }
interface ApiCommand { id: string; action: string; param?: string | null; status: 'PENDING' | 'ACKED' | 'EXPIRED'; result?: string | null; createdAt?: string }
interface HardwareState { online: boolean; receivedAt: string | null; commands?: ApiCommand[] }
type ProbeSensorKey = 'ph' | 'turb' | 'orp' | 'temp';
type SensorKey = ProbeSensorKey | 'tank';
type CalAction = 'CAL_CAPTURE' | 'CAL_STATUS' | 'CAL_CLEAR' | 'CAL_RESET';

const SENSORS: Array<{
  key: ProbeSensorKey; health: 'ph' | 'turbidity' | 'orp' | 'temperature'; title: string; optional?: boolean;
  // 'value' when the sensor is digital and reports no separate probe input (DS18B20).
  input: 'voltage' | 'rawAdc' | 'value'; inputUnit: string;
  steadyWithin: number; refLabel: string; refUnit: string; min: number; max: number; presets: number[]; steps: string[]; hint?: string;
  // Active water-monitor firmware calibrates pH from the ESP32 Serial Monitor, not MQTT CAL_* commands.
  serialOnly?: boolean;
}> = [
  {
    key: 'ph', health: 'ph', title: 'pH', input: 'voltage', inputUnit: 'V', steadyWithin: 0.01,
    refLabel: 'Buffer value', refUnit: 'pH', min: 0, max: 14, presets: [6.86, 4.01, 9.18],
    serialOnly: true,
    steps: [
      'Open the ESP32 Serial Monitor at 115200 baud (PlatformIO / Arduino IDE).',
      'Rinse and blot the probe, put it in a known buffer (for example 6.86), and wait until Voltage and pH Value settle.',
      'Type the buffer value and press Enter, e.g. ph 6.86 — the firmware adjusts calibration_value and saves it in NVS.',
      'Optional checks: ph status  |  ph reset  |  help',
    ],
    hint: 'pH is no longer calibrated from this tab. Use Serial Monitor commands on the device. Formula: pH = -5.70 × V + offset (Program2-style trimmed ADC average on GPIO35).',
  },
  {
    key: 'turb', health: 'turbidity', title: 'Turbidity', input: 'voltage', inputUnit: 'V', steadyWithin: 0.03,
    refLabel: 'Standard', refUnit: 'NTU', min: 0, max: 3000, presets: [0],
    steps: ['Power the module from 5 V and set its switch to Analog (A).', 'Put the sensor in clear water, wait for Steady (~2–3 V or higher), and capture 0 NTU.', 'Put it in a known standard (e.g. 100 NTU), wait, and capture that value.'],
    hint: 'If voltage stays near 0 V, the sensor is not reaching the ESP32 — check 5 V power, the A/D switch, and GPIO34 wiring.',
  },
  {
    key: 'orp', health: 'orp', title: 'ORP / redox', input: 'voltage', inputUnit: 'V', steadyWithin: 0.01,
    refLabel: 'Standard', refUnit: 'mV', min: -2000, max: 2000, presets: [],
    steps: ['Put the probe in an ORP standard solution and wait for Steady.', 'Enter the mV value printed on the solution and capture. One point corrects the offset; a second standard fits the slope too.'],
  },
  {
    key: 'temp', health: 'temperature', title: 'Temperature', optional: true, input: 'value', inputUnit: '°C', steadyWithin: 0.2,
    refLabel: 'Reference thermometer', refUnit: '°C', min: -10, max: 60, presets: [],
    steps: ['Put the DS18B20 and a trusted thermometer in the same water. Stir and wait for Steady.', 'Enter what the thermometer reads and capture. One point corrects the offset.', 'Optionally capture a second point at least 5 °C away (for example ice water at 0 °C) to fit the slope too.'],
    hint: 'Optional. The DS18B20 is factory calibrated (±0.5 °C) and its readings are used without this. Calibrate only if it disagrees with a thermometer you trust.',
  },
];

const parseResult = (sensor: SensorKey, result?: string | null): { state: MarkState; text: string } => {
  if (!result) return { state: 'off', text: 'No result reported' };
  const num = (key: string) => { const m = result.match(new RegExp(`${key}=(-?[\\d.]+)`)); return m ? Number(m[1]) : null; };
  const n = num('n'); const slope = num('slope'); const offset = num('offset');
  if (sensor === 'tank') {
    const mount = slope; const target = offset;
    if (result.startsWith('saved') || result.startsWith('status') || result.startsWith('reset')) {
      const mountText = n && mount != null && mount > 0 ? `mount ${mount.toFixed(2)} cm` : 'mount not set';
      const targetText = target != null ? `target ${target.toFixed(2)} cm` : 'target not set';
      if (result.startsWith('saved')) return { state: 'ok', text: `Saved on the device: ${mountText}, ${targetText}.` };
      if (result.startsWith('reset')) return { state: 'ok', text: `Tank calibration reset. ${targetText}. Capture empty tub again before using depth.` };
      return { state: 'info', text: `Device tank calibration: ${mountText}, ${targetText}.` };
    }
    if (result === 'cleared') return { state: 'info', text: 'No ephemeral tank points to clear. Use Reset to clear mount height.' };
  }
  const line = slope !== null && offset !== null
    ? `slope ${slope}, offset ${offset}${sensor === 'ph' && slope !== 0 ? ` (${(1000 / Math.abs(slope)).toFixed(1)} mV per pH)` : ''}`
    : '';
  if (result.startsWith('saved')) return { state: 'ok', text: `Saved on the device, fitted from ${n} point${n === 1 ? '' : 's'}: ${line}.` };
  if (result.startsWith('recorded')) {
    const need = num('need');
    const x = num('x');
    if (need != null && n != null) return { state: 'info', text: `Point ${n} of ${need} recorded${x != null ? ` (input ${x.toFixed(4)} V)` : ''}. Capture the remaining distinct buffers.` };
    return { state: 'info', text: `Point recorded${x != null ? ` (input ${x.toFixed(4)})` : ''}. Capture the next reference to finish.` };
  }
  if (result.startsWith('status')) return { state: 'info', text: `Saved calibration: ${line}. ${n} point${n === 1 ? '' : 's'} captured since the device started.` };
  if (result.startsWith('reset')) return { state: 'ok', text: `Reset to the default calibration and saved: ${line}.` };
  if (result === 'cleared') return { state: 'info', text: 'Captured points cleared. The saved calibration is unchanged.' };
  return { state: 'alarm', text: describeDeviceResult(result) };
};

const sensorOfParam = (param?: string | null): SensorKey | null => {
  const key = (param || '').split(':')[0];
  return key === 'ph' || key === 'turb' || key === 'orp' || key === 'temp' || key === 'tank' ? key : null;
};

const actionLabel: Record<CalAction, string> = { CAL_CAPTURE: 'Capture', CAL_STATUS: 'Read calibration', CAL_CLEAR: 'Clear points', CAL_RESET: 'Reset' };

const DashboardCalibrationPage: React.FC = () => {
  const { latestReading } = useDashboardData();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [hardware, setHardware] = useState<HardwareState | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [references, setReferences] = useState<Record<ProbeSensorKey, string>>({ ph: '6.86', turb: '0', orp: '', temp: '' });
  const [tankTarget, setTankTarget] = useState('3');
  const [sending, setSending] = useState<SensorKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<Partial<Record<SensorKey, string>>>({});
  const recentInputs = useRef<Record<ProbeSensorKey, number[]>>({ ph: [], turb: [], orp: [], temp: [] });
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

  // Keep recent live inputs per sensor to judge whether the probe has settled.
  const live = isReadingLive(latestReading);
  useEffect(() => {
    const stamp = latestReading?.timestamp ? String(latestReading.timestamp) : null;
    if (!live || !stamp || stamp === lastFrame.current) return;
    lastFrame.current = stamp;
    for (const sensor of SENSORS) {
      const health = latestReading?.sensorHealth?.[sensor.health];
      const x = health ? health[sensor.input] : null;
      const list = recentInputs.current[sensor.key];
      if (typeof x === 'number' && Number.isFinite(x)) { list.push(x); if (list.length > 6) list.shift(); }
      else list.length = 0;
    }
  }, [latestReading, live]);

  // Captures need either a fresh hardware state ack path or a live sensor frame.
  const fresh = (hardware?.online === true && loadedAt !== null && Date.now() - loadedAt < 30000) || live;

  const send = async (sensor: SensorKey, action: CalAction, captureParam?: string) => {
    if (!deviceId) return;
    let param: string = sensor;
    if (action === 'CAL_CAPTURE') {
      if (sensor === 'tank') {
        if (!captureParam) { setError('Choose empty capture or a target depth.'); return; }
        param = captureParam;
      } else {
        const config = SENSORS.find((item) => item.key === sensor)!;
        const value = Number(references[sensor]);
        if (references[sensor].trim() === '' || !Number.isFinite(value) || value < config.min || value > config.max) {
          setError(`Enter a ${config.refLabel.toLowerCase()} between ${config.min} and ${config.max}${config.refUnit ? ` ${config.refUnit}` : ''}.`);
          return;
        }
        param = `${sensor}:${Number(value.toFixed(3))}`;
      }
    }
    if (action === 'CAL_RESET' && !window.confirm(sensor === 'tank'
      ? 'Reset tank mount height and restore the default 3 cm target on the device?'
      : 'Reset this sensor to the default calibration? The saved calibration on the device will be replaced.')) return;
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

  const sendTankTarget = () => {
    const value = Number(tankTarget);
    if (!Number.isFinite(value) || value <= 0 || value > 200) {
      setError('Enter a target water depth between 0 and 200 cm.');
      return;
    }
    void send('tank', 'CAL_CAPTURE', `tank:target:${Number(value.toFixed(3))}`);
  };

  return (
    <div className="space-y-5">
      <PageHead
        title="Calibration"
        description="Calibrate turbidity and ORP against reference solutions, optionally temperature against a trusted thermometer, and tank depth from the ultrasonic sensor. pH is calibrated on the ESP32 Serial Monitor (ph <buffer>), not from this tab."
        meta={<MetaItem label="Device"><StateMark state={fresh ? 'ok' : 'off'} className="!text-sm !font-semibold">{fresh ? 'Online' : 'Offline or stale'}</StateMark></MetaItem>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Panel title="Device">
          <DeviceSelect id="calibration-device" value={deviceId} devices={devices} onChange={(value) => { setDeviceId(value); setHardware(null); setLastCommand({}); }} />
        </Panel>
        <Notice tone="info" title="Before you start">
          A saved capture is stored on the ESP32 and recorded by the server, so the dashboard can classify that sensor. Temperature (DS18B20) is factory calibrated, so its calibration is optional; capture it only to match a trusted thermometer. Resetting a sensor clears that record.
        </Notice>
      </div>

      {!fresh && <Notice tone="warn" title="Device not reporting">Captures need live readings. Check that the ESP32 is powered and connected, then come back.</Notice>}
      {error && <Notice tone="alarm">{error}</Notice>}

      {(() => {
        const tank = live ? (latestReading?.tankLevel ?? latestReading?.sensorHealth?.ultrasonic ?? null) : null;
        const tracked = commands.find((item) => item.id === lastCommand.tank)
          ?? commands.find((item) => sensorOfParam(item.param) === 'tank');
        const trackedPending = tracked?.status === 'PENDING';
        const outcome = !tracked ? null
          : tracked.status === 'PENDING' ? { state: 'info' as MarkState, text: 'Sent, waiting for the device…' }
            : tracked.status === 'EXPIRED' ? { state: 'warn' as MarkState, text: 'The device did not answer before the command expired.' }
              : parseResult('tank', tracked.result);
        const busy = sending === 'tank' || trackedPending;
        return (
          <Panel title="Tank depth (ultrasonic)" actions={<StateMark state={tank?.valid ? 'ok' : live && tank ? 'warn' : 'off'}>{tank?.valid ? 'Live echo' : live && tank ? (tank.reason || 'No valid echo') : 'No live data'}</StateMark>}>
            <div className="space-y-4">
              <div className="grid gap-px overflow-hidden rounded-md border border-line-soft bg-line-soft sm:grid-cols-4">
                {[
                  ['Distance', tank?.distanceCm != null ? `${tank.distanceCm.toFixed(1)} cm` : '—'],
                  ['Depth', tank?.depthCm != null ? `${tank.depthCm.toFixed(2)} cm` : '—'],
                  ['Mount', tank?.mountHeightCm != null ? `${tank.mountHeightCm.toFixed(1)} cm` : '—'],
                  ['Target', tank?.targetDepthCm != null ? `${tank.targetDepthCm.toFixed(2)} cm` : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="bg-white px-3.5 py-3">
                    <p className="text-xs text-ink-3">{label}</p>
                    <p className="num mt-0.5 text-sm font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <ol className="list-decimal space-y-1 pl-4 text-[13px] leading-relaxed text-ink-2">
                <li>Drain the tub so the sensor sees the bottom (or a known empty reference), wait for a steady distance, then capture empty.</li>
                <li>Set the desired water column (for crayfish, typically 3 cm). Depth = mount height − distance.</li>
                <li>On Water change, Normal/Warning/Alert follow Thresholds; Fill to target restores lost depth when you press it.</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!deviceId || !fresh || busy} onClick={() => void send('tank', 'CAL_CAPTURE', 'tank:empty')} className="btn-primary">Capture empty (mount)</button>
                <div className="flex min-w-[220px] flex-1 gap-2">
                  <input id="tank-target" type="number" inputMode="decimal" step="0.1" min="0.1" max="200" value={tankTarget} onChange={(event) => setTankTarget(event.target.value)} className="field num min-w-0 flex-1" aria-label="Target water depth in cm" />
                  <button type="button" disabled={!deviceId || !fresh || busy} onClick={sendTankTarget} className="btn-secondary shrink-0">Set target cm</button>
                </div>
              </div>
              <div aria-live="polite" className="min-h-[1.25rem]">
                {outcome && <StateMark state={outcome.state}>{outcome.text}</StateMark>}
              </div>
              <div className="flex flex-wrap gap-1 border-t border-line-soft pt-3">
                <button type="button" disabled={!deviceId || !fresh || busy} onClick={() => void send('tank', 'CAL_STATUS')} className="btn-quiet btn-sm">Read saved calibration</button>
                <button type="button" disabled={!deviceId || !fresh || busy} onClick={() => void send('tank', 'CAL_RESET')} className="btn-quiet btn-sm !text-alarm hover:!bg-alarm-bg">Reset tank</button>
              </div>
            </div>
          </Panel>
        );
      })()}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {SENSORS.map((sensor) => {
          const health = latestReading?.sensorHealth?.[sensor.health];
          const input = live && health ? health[sensor.input] : null;
          const healthValue = live && health && typeof health.value === 'number' && Number.isFinite(health.value) ? health.value : null;
          const reading = !live ? null
            : sensor.key === 'ph' ? (latestReading?.ph ?? healthValue)
              : sensor.key === 'turb' ? (latestReading?.turbidityUnit === 'NTU' ? (latestReading?.turbidity ?? healthValue) : healthValue)
                : sensor.key === 'temp' ? (latestReading?.temperature ?? healthValue)
                  : (latestReading?.orp ?? healthValue);
          const samples = recentInputs.current[sensor.key];
          const spread = samples.length >= 3 ? Math.max(...samples) - Math.min(...samples) : null;
          const steady = spread !== null && spread <= sensor.steadyWithin;
          const calMark = health?.calibration === 'CALIBRATED' ? 'Calibrated' : health?.calibration === 'REQUIRED' ? 'Needs calibration' : null;
          const healthState = health?.health;
          const probeBad = healthState === 'SATURATED' || healthState === 'SENSOR_ERROR' || healthState === 'MISSING'
            || health?.valid === false && (healthState === 'INVALID' || health?.reason?.toLowerCase().includes('disconnect'));
          const railStuck = sensor.input === 'voltage' && input != null && (input >= 3.15 || input <= 0.05);
          const settle: { state: MarkState; text: string } = !live || input == null ? { state: 'off', text: calMark || 'No live input' }
            : healthState === 'SATURATED' || railStuck ? { state: 'alarm', text: 'ADC rail / open — fix wiring' }
              : probeBad ? { state: 'alarm', text: health?.reason || 'Probe not ready' }
                : spread === null ? { state: 'info', text: 'Measuring…' }
                  : steady ? { state: 'ok', text: calMark ? `Steady · ${calMark}` : 'Steady' } : { state: 'warn', text: 'Settling' };

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
              title={sensor.optional
                ? <span className="inline-flex items-center gap-2">{sensor.title}<span className="rounded border border-line px-1.5 py-px text-[11px] font-medium text-ink-3">Optional</span></span>
                : sensor.title}
              actions={<StateMark state={settle.state}>{settle.text}</StateMark>}
              bodyClassName="flex flex-col gap-4 p-4 sm:p-5"
            >
              <div className={`grid gap-px overflow-hidden rounded-md border border-line-soft bg-line-soft ${sensor.input === 'value' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {sensor.input !== 'value' && (
                  <div className="bg-white px-3.5 py-3">
                    <p className="text-xs text-ink-3">Probe input</p>
                    <p className="num mt-0.5 text-xl font-semibold">{input == null ? '—' : sensor.input === 'voltage' ? input.toFixed(4) : Math.round(input)}<span className="ml-1 text-xs font-medium text-ink-3">{sensor.inputUnit}</span></p>
                  </div>
                )}
                <div className="bg-white px-3.5 py-3">
                  <p className="text-xs text-ink-3">Current reading</p>
                  <p className="num mt-0.5 text-xl font-semibold">{reading == null ? '—' : reading.toFixed(sensor.key === 'ph' || sensor.key === 'temp' ? 2 : 1)}<span className="ml-1 text-xs font-medium text-ink-3">{sensor.key === 'ph' ? '' : sensor.refUnit}</span></p>
                </div>
              </div>

              <ol className="list-decimal space-y-1 pl-4 text-[13px] leading-relaxed text-ink-2">
                {sensor.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              {sensor.hint && <p className="-mt-2 text-xs leading-relaxed text-ink-3">{sensor.hint}</p>}

              {sensor.serialOnly ? (
                <Notice tone="info" title="Serial Monitor only">
                  Enter the buffer on the device, for example <span className="num font-semibold">ph 6.86</span>. Dashboard Capture / Reset for pH are disabled on the active water-monitor firmware.
                </Notice>
              ) : (
                <>
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
                        placeholder={sensor.key === 'orp' ? 'e.g. 225' : sensor.key === 'temp' ? 'e.g. 28.4' : ''} className="field num min-w-0 flex-1" />
                      <button type="submit" disabled={!deviceId || !fresh || busy} title={!fresh ? 'Device must report live readings before a capture.' : !steady && live ? 'Wait until the probe shows Steady for a cleaner capture.' : undefined} className="btn-primary h-10 shrink-0">
                        {busy ? 'Capturing…' : 'Capture point'}
                      </button>
                    </div>
                    {live && !steady && input != null && <p className="text-xs text-ink-3">Wait for Steady before capturing when you can — the device still accepts a capture while settling.</p>}
                  </form>

                  <div aria-live="polite" className="min-h-[1.25rem]">
                    {outcome && <StateMark state={outcome.state}>{outcome.text}</StateMark>}
                  </div>

                  <div className="mt-auto flex flex-wrap gap-1 border-t border-line-soft pt-3">
                    <button type="button" disabled={!deviceId || !fresh || busy} onClick={() => void send(sensor.key, 'CAL_STATUS')} className="btn-quiet btn-sm">Read saved calibration</button>
                    <button type="button" disabled={!deviceId || !fresh || busy} onClick={() => void send(sensor.key, 'CAL_CLEAR')} className="btn-quiet btn-sm">Clear points</button>
                    <button type="button" disabled={!deviceId || !fresh || busy} onClick={() => void send(sensor.key, 'CAL_RESET')} className="btn-quiet btn-sm !text-alarm hover:!bg-alarm-bg">Reset to default</button>
                  </div>
                </>
              )}
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
                  const reference = item.param?.includes(':') ? item.param.slice(item.param.indexOf(':') + 1) : null;
                  const parsed = item.status === 'PENDING' ? { state: 'info' as MarkState, text: 'Waiting for the device' }
                    : item.status === 'EXPIRED' ? { state: 'warn' as MarkState, text: 'No answer before expiry' }
                      : parseResult(sensor ?? 'ph', item.result);
                  return (
                    <tr key={item.id} className="align-top hover:bg-water">
                      <td className="whitespace-nowrap px-5 py-2.5 text-ink-2">{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2.5">{sensor === 'tank' ? 'Tank depth' : SENSORS.find((s) => s.key === sensor)?.title ?? '—'}</td>
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
