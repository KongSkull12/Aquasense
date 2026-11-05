import React, { useEffect, useMemo, useState } from 'react';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import { isReadingLive } from '../../components/WaterQuality/sensorDisplay';
import { KeyValues, Notice, PageHead, Panel, StateMark } from '../../components/WaterQuality/Console';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import type { AmmoniaCalculation } from '../../types/water';

type InputSource = 'live' | 'manual';
type MeasurementKind = 'none' | 'TAN' | 'NH3_N';

const fixed = (value: number | null | undefined, digits: number): string =>
  value === null || value === undefined ? '—' : value.toFixed(digits);

const parseNumber = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const Step = ({ number, title, formula, children }: { number: number; title: string; formula?: string; children: React.ReactNode }) => (
  <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-line py-3.5 last:border-b-0">
    <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-water text-xs font-semibold tabular-nums text-ink-2">{number}</span>
    <div className="min-w-0">
      <p className="text-sm font-semibold">{title}</p>
      {formula && <p className="mt-1 font-mono text-[12px] text-ink-2">{formula}</p>}
      <div className="mt-1.5 text-[13px] leading-relaxed">{children}</div>
    </div>
  </li>
);

const DashboardAmmoniaPage: React.FC = () => {
  const { latestReading } = useDashboardData();
  const live = isReadingLive(latestReading);
  const liveTemperature = live ? latestReading?.temperature ?? null : null;
  const livePh = live ? latestReading?.ph ?? null : null;
  const liveAvailable = liveTemperature !== null && livePh !== null;
  const phHealth = latestReading?.sensorHealth?.ph;
  const temperatureHealth = latestReading?.sensorHealth?.temperature;
  const liveUncalibrated = liveAvailable &&
    (phHealth?.calibration !== 'CALIBRATED' || temperatureHealth?.calibration !== 'CALIBRATED');

  const [source, setSource] = useState<InputSource>('live');
  const [manualTemperature, setManualTemperature] = useState('28');
  const [manualPh, setManualPh] = useState('8.0');
  const [kind, setKind] = useState<MeasurementKind>('none');
  const [measurementRaw, setMeasurementRaw] = useState('');
  const [result, setResult] = useState<AmmoniaCalculation | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fall back to manual entry while the device is not sending.
  const effectiveSource: InputSource = source === 'live' && !liveAvailable ? 'manual' : source;
  const temperature = effectiveSource === 'live' ? liveTemperature : parseNumber(manualTemperature);
  const ph = effectiveSource === 'live' ? livePh : parseNumber(manualPh);
  const measurement = kind === 'none' ? null : parseNumber(measurementRaw);

  const request = useMemo(() => {
    if (temperature === null || ph === null) return null;
    if (kind !== 'none' && measurement === null) return null;
    return {
      temperature,
      ph,
      ...(kind === 'TAN' && measurement !== null ? { tan: measurement } : {}),
      ...(kind === 'NH3_N' && measurement !== null ? { nh3N: measurement } : {}),
    };
  }, [temperature, ph, kind, measurement]);
  const requestKey = request ? JSON.stringify(request) : '';

  useEffect(() => {
    if (!request) { setResult(null); setError(null); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      apiClient.post<AmmoniaCalculation>('/water/ammonia/calculate', request)
        .then((response) => { if (active) { setResult(response.data); setError(null); } })
        .catch((err) => { if (active) { setResult(null); setError(getApiErrorMessage(err, 'Calculation failed')); } });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
    // requestKey captures every input; live readings refresh it about every 5 s.
  }, [requestKey]);

  const originLabel = (origin: 'measured' | 'calculated' | null) => origin === 'measured' ? 'Measured' : origin === 'calculated' ? 'Calculated' : 'Needs a measurement';

  return (
    <div className="space-y-5">
      <PageHead
        title="Ammonia calculator"
        description="Temperature and pH give the share of ammonia that is toxic NH₃. The actual concentration needs one ammonia measurement: TAN from a test kit, or NH₃-N."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Panel title="Inputs" description="Steps 1 and 5">
          <fieldset>
            <legend className="field-label">Temperature and pH</legend>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup">
              {(['live', 'manual'] as const).map((option) => (
                <label key={option} className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${effectiveSource === option ? 'border-ink bg-water font-semibold' : 'border-line'} ${option === 'live' && !liveAvailable ? 'cursor-not-allowed opacity-50' : ''}`}>
                  <input type="radio" name="ammonia-source" value={option} checked={effectiveSource === option}
                    disabled={option === 'live' && !liveAvailable} onChange={() => setSource(option)} className="sr-only" />
                  {option === 'live' ? 'Live sensors' : 'Enter manually'}
                </label>
              ))}
            </div>
            {!liveAvailable && <p className="field-hint">No live reading from the device, so values are entered manually.</p>}
          </fieldset>

          {effectiveSource === 'live' ? (
            <KeyValues className="mt-4" rows={[
              { label: 'Temperature (DS18B20)', value: <span className="tabular-nums">{fixed(liveTemperature, 1)} °C</span> },
              { label: 'pH (PH-4502C)', value: <span className="tabular-nums">{fixed(livePh, 2)}</span> },
            ]} />
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="ammonia-temperature">Temperature (°C)</label>
                <input id="ammonia-temperature" type="number" inputMode="decimal" step="0.1" min={0} max={50}
                  value={manualTemperature} onChange={(e) => setManualTemperature(e.target.value)} className="field tabular-nums" />
                <p className="field-hint">0–50 °C</p>
              </div>
              <div>
                <label className="field-label" htmlFor="ammonia-ph">pH</label>
                <input id="ammonia-ph" type="number" inputMode="decimal" step="0.01" min={0} max={14}
                  value={manualPh} onChange={(e) => setManualPh(e.target.value)} className="field tabular-nums" />
                <p className="field-hint">0–14</p>
              </div>
            </div>
          )}

          {effectiveSource === 'live' && liveUncalibrated && (
            <div className="mt-4">
              <Notice tone="warn" title="Sensors not calibrated">
                The live pH or temperature probe has no saved calibration, so these results are not reliable. Calibrate first, or enter values manually.
              </Notice>
            </div>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <label className="field-label" htmlFor="ammonia-kind">Ammonia measurement</label>
            <select id="ammonia-kind" value={kind} onChange={(e) => setKind(e.target.value as MeasurementKind)} className="field">
              <option value="none">None yet (NH₃ fraction only)</option>
              <option value="TAN">Option A: TAN measured (test kit)</option>
              <option value="NH3_N">Option B: NH₃-N measured independently</option>
            </select>
            {kind !== 'none' && (
              <div className="mt-3">
                <label className="field-label" htmlFor="ammonia-value">{kind === 'TAN' ? 'Measured TAN' : 'Measured NH₃-N'} (mg/L as N)</label>
                <input id="ammonia-value" type="number" inputMode="decimal" step="0.01" min={0}
                  value={measurementRaw} onChange={(e) => setMeasurementRaw(e.target.value)} className="field tabular-nums" placeholder="e.g. 0.50" />
              </div>
            )}
          </div>
        </Panel>

        <Panel
          title="Calculation"
          description="Freshwater equation (Emerson et al., 1975)"
          actions={result ? <StateMark state="ok">Calculated</StateMark> : undefined}
        >
          {error && <div className="mb-3"><Notice tone="alarm">{error}</Notice></div>}
          <ol>
            <Step number={1} title="Sensor data">
              Temperature <span className="tabular-nums font-semibold">{fixed(temperature, 1)} °C</span>, pH <span className="tabular-nums font-semibold">{fixed(ph, 2)}</span>
              <span className="text-ink-2"> · {effectiveSource === 'live' ? 'live sensors' : 'entered manually'}</span>
            </Step>
            <Step number={2} title="pKa" formula="pKa = 0.09018 + 2729.92 / (T + 273.15)">
              <span className="tabular-nums font-semibold">{fixed(result?.pKa, 3)}</span>
            </Step>
            <Step number={3} title="NH₃ fraction" formula="fNH₃ = 1 / (1 + 10^(pKa − pH))">
              <span className="tabular-nums font-semibold">{fixed(result?.nh3Fraction, 4)}</span>
            </Step>
            <Step number={4} title="NH₃ percentage" formula="NH₃ (%) = fNH₃ × 100">
              <span className="tabular-nums font-semibold">{result ? `${fixed(result.nh3Percent, 2)} %` : '—'}</span>
            </Step>
            <Step number={5} title="Ammonia measurement">
              {kind === 'none' ? <span className="text-ink-2">Not entered. Choose Option A or B to get concentrations.</span>
                : <>{kind === 'TAN' ? 'TAN' : 'NH₃-N'} <span className="tabular-nums font-semibold">{fixed(measurement, 2)} mg/L as N</span> <span className="text-ink-2">· measured</span></>}
            </Step>
            <Step number={6} title="Ammonia concentrations"
              formula={kind === 'TAN' ? 'NH₃-N = TAN × fNH₃' : kind === 'NH3_N' ? 'TAN = NH₃-N / fNH₃' : 'NH₃-N = TAN × fNH₃   or   TAN = NH₃-N / fNH₃'}>
              {result && result.tan !== null && result.nh3N !== null ? (
                <>{kind === 'TAN' ? 'NH₃-N' : 'TAN'} = <span className="tabular-nums font-semibold">{fixed(kind === 'TAN' ? result.nh3N : result.tan, 4)} mg/L as N</span></>
              ) : <span className="text-ink-2">Needs a TAN or NH₃-N measurement.</span>}
            </Step>
          </ol>
        </Panel>
      </div>

      <Panel title="Results" description="Step 7">
        <KeyValues rows={[
          { label: 'Temperature', value: <span className="tabular-nums">{fixed(result?.temperatureC ?? temperature, 1)} °C</span> },
          { label: 'pH', value: <span className="tabular-nums">{fixed(result?.ph ?? ph, 2)}</span> },
          { label: 'pKa', value: <span className="tabular-nums">{fixed(result?.pKa, 3)}</span> },
          { label: 'NH₃ fraction', value: <span className="tabular-nums">{fixed(result?.nh3Fraction, 4)}</span> },
          { label: 'NH₃ percentage', value: <span className="tabular-nums">{result ? `${fixed(result.nh3Percent, 2)} %` : '—'}</span> },
          { label: 'TAN', value: <span className="tabular-nums">{result?.tan !== null && result?.tan !== undefined ? `${fixed(result.tan, 4)} mg/L as N` : '—'} <span className="text-ink-2">· {originLabel(result?.tanOrigin ?? null)}</span></span> },
          { label: 'NH₃-N', value: <span className="tabular-nums">{result?.nh3N !== null && result?.nh3N !== undefined ? `${fixed(result.nh3N, 4)} mg/L as N` : '—'} <span className="text-ink-2">· {originLabel(result?.nh3NOrigin ?? null)}</span></span> },
        ]} />
        <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
          Temperature and pH set the NH₃ percentage only. TAN is never estimated from the sensors: it is either measured, or calculated from a measured NH₃-N.
        </p>
      </Panel>
    </div>
  );
};

export default DashboardAmmoniaPage;
