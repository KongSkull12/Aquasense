import type { WaterQualityReading, TanMeasurementRecord } from '../../types/water';
import { StateMark, type MarkState } from './Console';

const sensorLabel = { temperature: 'Temperature', ph: 'pH', turbidity: 'Turbidity', orp: 'ORP' } as const;

export function SensorHealthPanel({reading}:{reading:WaterQualityReading|null}) {
  const health=reading?.sensorHealth;
  return <section className="panel" aria-labelledby="sensor-health-heading">
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft px-4 py-3.5 sm:px-5">
      <h2 id="sensor-health-heading" className="text-[15px] font-semibold">Sensor health</h2>
      <p className="text-[13px] text-ink-3">Stable signals do not prove measurement accuracy. Calibration is required.</p>
    </div>
    <div className="grid gap-px bg-line-soft sm:grid-cols-2 xl:grid-cols-4">
      {(['temperature','ph','turbidity','orp'] as const).map(name=> {
        const s=health?.[name];
        const displayedValue = name === 'turbidity'
          ? reading?.turbidityUnit === 'NTU' ? reading.turbidity : null
          : s?.value ?? null;
        const qualified = s?.calibration==='CALIBRATED' && s?.stability==='STABLE';
        const state: MarkState = !s || s.health === 'MISSING' ? 'off' : s.health === 'STALE' || s.health === 'UNSTABLE' ? 'warn' : !s.valid ? 'off' : qualified ? 'ok' : 'trust';
        return <div key={name} className="bg-white px-4 py-4 text-[13px] leading-relaxed text-ink-2 sm:px-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">{sensorLabel[name]}</h3>
            <span className="num font-semibold text-ink">{s?.valid && displayedValue!==null ? `${displayedValue.toFixed(2)} ${name === 'turbidity' ? 'NTU' : s?.unit ?? ''}` : '—'}</span>
          </div>
          <StateMark state={state} className="mt-1.5">
            {s?.health ? s.health.charAt(0) + s.health.slice(1).toLowerCase().replace(/_/g, ' ') : 'Missing'}
            {s?.valid && displayedValue !== null ? (qualified ? ' · qualified' : ' · calibration required') : ''}
          </StateMark>
          <dl className="mt-3 space-y-1">
            <div className="flex justify-between gap-3"><dt>Water quality</dt><dd className="text-ink">{(reading?.waterQuality?.[name] || 'UNAVAILABLE').toLowerCase().replace(/_/g, ' ')}</dd></div>
            <div className="flex justify-between gap-3"><dt>Stability</dt><dd className="text-ink">{(s?.stability || 'COLLECTING').toLowerCase()}</dd></div>
          </dl>
          {name==='orp' && s?.health==='MISSING' && s.value!==null && s.reason.includes('not commissioned') &&
            <p className="mt-2 text-note">Device-reported diagnostic: {s.value.toFixed(2)} mV. Uncalibrated, not a validated measurement.</p>}
          {s?.rawAvailable && !s.measurementValid && <p className="mt-2 text-note">Signal available; engineering measurement unavailable.</p>}
          {s?.reason && <p className="mt-2 text-warn">{s.reason}</p>}
          {name === 'turbidity' ? <>
            <p className="mt-2 text-note">{reading?.turbidityUnit === 'NTU' && s?.valid ? 'Linear ADC estimate reported; sensor calibration is required.' : 'NTU unavailable for this sample.'}</p>
            <p className="num mt-1 text-xs text-ink-3">ADC pin {s?.voltage?.toFixed(3) ?? '—'} V · raw {s?.rawAdc ?? '—'} · burst {s?.adcMinimum ?? '—'}–{s?.adcMaximum ?? '—'}</p>
          </> : <details className="mt-2 group">
            <summary className="cursor-pointer select-none text-xs font-semibold text-sounding hover:text-sounding-dark">Calibration diagnostics</summary>
            <div className="num mt-1.5 space-y-0.5 text-xs text-ink-3">
              <p>Raw ADC {s?.rawAdc ?? '—'} · input {s?.voltage?.toFixed(4) ?? '—'} V</p>
              <p>ADC burst: last {s?.adcLast ?? '—'} / min {s?.adcMinimum ?? '—'} / max {s?.adcMaximum ?? '—'} / clipped {s?.clippedSamples ?? '—'}</p>
              <p>Samples {s?.window.count ?? 0} · range {s?.window.range?.toFixed(3) ?? '—'}</p>
              <p>Min {s?.window.min?.toFixed(3) ?? '—'} · max {s?.window.max?.toFixed(3) ?? '—'} · mean {s?.window.average?.toFixed(3) ?? '—'}</p>
              <p>Ready for calibration: {s?.readyForCalibration?'yes':'observe / check'}</p>
            </div>
          </details>}
        </div>;
      })}
    </div>
  </section>;
}
export function AmmoniaSpeciationCard({measurement}:{measurement:TanMeasurementRecord|null}) {
  return <div className="panel p-4 text-[13px] leading-relaxed text-ink-2" title="Freshwater NH3-N is calculated from measured TAN, pH and temperature only when their sample times align and source sensors qualify.">
    <h3 className="text-sm font-semibold text-ink">Unionized NH₃ fraction of TAN</h3>
    <p className="num my-1 text-xl font-semibold text-ink">{measurement?.nh3Fraction != null ? `${(measurement.nh3Fraction * 100).toFixed(2)}%`:'Unavailable'}</p>
    <p>TAN: {measurement ? `${measurement.value} ${measurement.unit}`:'not available'}</p>
    <p>NH₃-N: {measurement?.nh3N != null ? `${measurement.nh3N.toFixed(5)} mg/L as N`:'not calculated; aligned qualified pH and temperature required'}</p>
    {measurement && <>
      <p className="mt-1">Source: {measurement.source} · {measurement.validationStatus.toLowerCase().replace('_', ' ')}</p>
      <p>Sample collected: {new Date(measurement.sampleCollectedAt).toLocaleString()} · Entered: {new Date(measurement.enteredAt).toLocaleString()}</p>
      <p>Evidence: {measurement.validationEvidence}</p>
    </>}
    <p className="mt-1">{measurement?.speciationReason || 'Enter an actual TAN measurement; its hazard remains unassessed until then.'}</p>
    <p className="mt-1 text-note">Freshwater estimate only. Calibration and test-method accuracy are not certified by AquaSense.</p>
  </div>;
}
