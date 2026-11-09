import React, { useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import { Notice, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';
import {
  bandLabel,
  classifyBand,
  DEFAULT_THRESHOLD_BANDS,
  type BandKey,
  type ParameterBand,
  type ThresholdBands,
} from '../../components/WaterQuality/thresholdBands';

const KEYS: BandKey[] = ['temperature', 'ph', 'turbidity', 'waterDepth'];

const COPY: Record<BandKey, { label: string; unit: string; digits: number; highOnly: boolean; note: string }> = {
  temperature: {
    label: 'Temperature',
    unit: '°C',
    digits: 1,
    highOnly: false,
    note: 'Normal is the 26–29 °C growth range. Alert below 15 °C or above 32 °C matches the critical cuts in the alert rules. The gap between them is Warning.',
  },
  ph: {
    label: 'pH',
    unit: '',
    digits: 2,
    highOnly: false,
    note: 'Normal is the 7.0–8.5 culture guidance. Alert below 6.0 or above 8.5 matches the critical cuts. Above 8.5 is Alert immediately, so the high alert limit can sit on the top of Normal.',
  },
  turbidity: {
    label: 'Turbidity',
    unit: 'NTU',
    digits: 1,
    highOnly: true,
    note: 'The alert rules warn above 70 NTU and mark critical above 100 NTU. These are not a commissioned species limit.',
  },
  waterDepth: {
    label: 'Water depth',
    unit: 'cm',
    digits: 1,
    highOnly: false,
    note: 'For a crayfish tub with a 3 cm target: Normal around 2.7–3.3 cm. Alert below 2.0 cm or above 4.0 cm. Needs empty-tub mount calibration on the Calibration page before live depth is classified.',
  },
};

type Draft = Record<BandKey, Record<keyof ParameterBand, string>>;

const toDraft = (bands: ThresholdBands): Draft => {
  const draft = {} as Draft;
  for (const key of KEYS) {
    const band = bands[key];
    draft[key] = {
      alertMin: band.alertMin == null ? '' : String(band.alertMin),
      normalMin: band.normalMin == null ? '' : String(band.normalMin),
      normalMax: band.normalMax == null ? '' : String(band.normalMax),
      alertMax: band.alertMax == null ? '' : String(band.alertMax),
    };
  }
  return draft;
};

const parseDraft = (draft: Draft): ThresholdBands | null => {
  const bands = {} as ThresholdBands;
  for (const key of KEYS) {
    const copy = COPY[key];
    const read = (name: keyof ParameterBand): number | null => {
      const raw = draft[key][name].trim();
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : Number.NaN;
    };
    const alertMin = copy.highOnly ? null : read('alertMin');
    const normalMin = copy.highOnly ? null : read('normalMin');
    const normalMax = read('normalMax');
    const alertMax = read('alertMax');
    if ([alertMin, normalMin, normalMax, alertMax].some((value) => Number.isNaN(value))) return null;
    bands[key] = { alertMin, normalMin, normalMax, alertMax };
  }
  return bands;
};

const markState = (label: string): MarkState =>
  label === 'Normal' ? 'ok' : label === 'Warning' ? 'warn' : label === 'Alert' ? 'alarm' : 'off';

const DashboardThresholdsPage: React.FC = () => {
  const { latestReading } = useDashboardData();
  const [draft, setDraft] = useState<Draft>(() => toDraft(DEFAULT_THRESHOLD_BANDS));
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiClient.get<ThresholdBands>('/water/threshold-bands');
        if (!active) return;
        setDraft(toDraft(response.data));
        setSaved(true);
        setError(null);
      } catch (cause) {
        if (active) setError(getApiErrorMessage(cause, 'Unable to load thresholds.'));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const parsed = parseDraft(draft);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!parsed) {
      setError('Enter each limit as a number.');
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiClient.put<ThresholdBands>('/water/threshold-bands', parsed);
      setDraft(toDraft(response.data));
      setSaved(true);
      setNotice('Thresholds saved. Overview and Parameters use them on the next refresh.');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to save thresholds.'));
    } finally {
      setPending(false);
    }
  };

  const setField = (key: BandKey, name: keyof ParameterBand, value: string) => {
    setDraft((current) => ({ ...current, [key]: { ...current[key], [name]: value } }));
    setSaved(false);
  };

  const liveValue = (key: BandKey): number | null => {
    if (!latestReading) return null;
    if (key === 'waterDepth') {
      const tank = latestReading.tankLevel ?? latestReading.sensorHealth?.ultrasonic ?? null;
      return tank?.valid && tank.depthCm != null ? tank.depthCm : null;
    }
    const health = latestReading.sensorHealth?.[key];
    const qualified = health?.valid === true && health.health === 'VALID' && health.calibration === 'CALIBRATED' && health.stability === 'STABLE';
    if (!qualified) return null;
    if (key === 'temperature') return latestReading.temperature;
    if (key === 'ph') return latestReading.ph ?? health.value ?? null;
    return latestReading.turbidityUnit === 'NTU' ? latestReading.turbidity : null;
  };

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-5">
      <PageHead
        title="Thresholds"
        description="Normal, Warning, and Alert for live temperature, pH, turbidity, and water depth. A calibrated, stable reading is classified. Uncalibrated readings stay unclassified."
        meta={saved ? <StateMark state="ok" className="!text-sm !font-semibold">Saved</StateMark> : undefined}
      />

      <Notice tone="info" title="What these limits change">
        Saving updates the marks on Overview, Parameters, and Water change. SMS alerts keep the built-in rule cuts, so a change here does not by itself change a text.
      </Notice>

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {KEYS.map((key) => {
          const copy = COPY[key];
          const value = liveValue(key);
          const level = parsed && value != null ? bandLabel(classifyBand(value, parsed[key])) : null;
          return (
            <Panel key={key} title={copy.label} description={copy.note}>
              <div className="space-y-3">
                {!copy.highOnly && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="field-label" htmlFor={`${key}-alert-min`}>Alert below</label>
                      <input id={`${key}-alert-min`} className="field num" inputMode="decimal" disabled={loading || pending} value={draft[key].alertMin} onChange={(event) => setField(key, 'alertMin', event.target.value)} />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`${key}-normal-min`}>Normal from</label>
                      <input id={`${key}-normal-min`} className="field num" inputMode="decimal" disabled={loading || pending} value={draft[key].normalMin} onChange={(event) => setField(key, 'normalMin', event.target.value)} />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label" htmlFor={`${key}-normal-max`}>{copy.highOnly ? 'Normal at or below' : 'Normal to'}</label>
                    <input id={`${key}-normal-max`} className="field num" inputMode="decimal" disabled={loading || pending} value={draft[key].normalMax} onChange={(event) => setField(key, 'normalMax', event.target.value)} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`${key}-alert-max`}>Alert above</label>
                    <input id={`${key}-alert-max`} className="field num" inputMode="decimal" disabled={loading || pending} value={draft[key].alertMax} onChange={(event) => setField(key, 'alertMax', event.target.value)} />
                  </div>
                </div>
                {level && (
                  <p className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
                    <span className="num">{value!.toFixed(copy.digits)}{copy.unit ? ` ${copy.unit}` : ''}</span>
                    <StateMark state={markState(level)} className="!text-xs">{level}</StateMark>
                  </p>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={loading || pending || !parsed}>
          {pending ? 'Saving…' : 'Save thresholds'}
        </button>
        <p className="text-xs leading-relaxed text-ink-3">ORP, tank level, and the NH₃ fraction have no husbandry band. Dissolved oxygen is not measured on this station.</p>
      </div>

      {error && <Notice tone="alarm" title="Thresholds">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
    </form>
  );
};

export default DashboardThresholdsPage;
