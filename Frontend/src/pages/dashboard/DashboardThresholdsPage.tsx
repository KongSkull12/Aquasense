import React, { useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import { Notice, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';
import {
  bandIssue,
  bandLabel,
  classifyBand,
  DEFAULT_THRESHOLD_BANDS,
  type BandKey,
  type ParameterBand,
  type ThresholdBands,
} from '../../components/WaterQuality/thresholdBands';

const KEYS: BandKey[] = ['temperature', 'ph', 'turbidity', 'waterDepth'];

const COPY: Record<BandKey, { label: string; unit: string; digits: number; highOnly: boolean; hint?: string }> = {
  temperature: { label: 'Temperature', unit: '°C', digits: 1, highOnly: false },
  ph: { label: 'pH', unit: '', digits: 2, highOnly: false },
  turbidity: { label: 'Turbidity', unit: 'NTU', digits: 1, highOnly: true, hint: 'Starting values, not a species limit.' },
  waterDepth: { label: 'Water depth', unit: 'cm', digits: 1, highOnly: false, hint: 'Needs the empty-tub step on the Calibration page.' },
};

type BandDraft = Record<keyof ParameterBand, string>;
type Draft = Record<BandKey, BandDraft>;

const toBandDraft = (band: ParameterBand): BandDraft => ({
  alertMin: band.alertMin == null ? '' : String(band.alertMin),
  normalMin: band.normalMin == null ? '' : String(band.normalMin),
  normalMax: band.normalMax == null ? '' : String(band.normalMax),
  alertMax: band.alertMax == null ? '' : String(band.alertMax),
});

const toDraft = (bands: ThresholdBands): Draft => {
  const draft = {} as Draft;
  for (const key of KEYS) draft[key] = toBandDraft(bands[key]);
  return draft;
};

/** Null when any field is not a number. */
const parseBand = (key: BandKey, draft: BandDraft): ParameterBand | null => {
  const read = (name: keyof ParameterBand): number | null => {
    const raw = draft[name].trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : Number.NaN;
  };
  const highOnly = COPY[key].highOnly;
  const band: ParameterBand = {
    alertMin: highOnly ? null : read('alertMin'),
    normalMin: highOnly ? null : read('normalMin'),
    normalMax: read('normalMax'),
    alertMax: read('alertMax'),
  };
  return Object.values(band).some((value) => Number.isNaN(value)) ? null : band;
};

const withUnit = (value: number | null, unit: string): string => `${value}${unit ? ` ${unit}` : ''}`;

const recommendedText = (key: BandKey): string => {
  const { normalMin, normalMax } = DEFAULT_THRESHOLD_BANDS[key];
  const unit = COPY[key].unit;
  return normalMin == null ? `Up to ${withUnit(normalMax, unit)}` : `${normalMin}–${withUnit(normalMax, unit)}`;
};

const alertSummary = (key: BandKey, band: ParameterBand): string => {
  const unit = COPY[key].unit;
  const high = `above ${withUnit(band.alertMax, unit)}`;
  const alert = COPY[key].highOnly ? `Alert ${high}.` : `Alert below ${withUnit(band.alertMin, unit)} or ${high}.`;
  return `${alert} Anything else outside normal is a Warning.`;
};

const sameBand = (a: ParameterBand, b: ParameterBand): boolean =>
  a.alertMin === b.alertMin && a.normalMin === b.normalMin && a.normalMax === b.normalMax && a.alertMax === b.alertMax;

const markState = (label: string): MarkState =>
  label === 'Normal' ? 'ok' : label === 'Warning' ? 'warn' : label === 'Alert' ? 'alarm' : 'off';

const DashboardThresholdsPage: React.FC = () => {
  const { latestReading } = useDashboardData();
  const [draft, setDraft] = useState<Draft>(() => toDraft(DEFAULT_THRESHOLD_BANDS));
  const [alertsOpen, setAlertsOpen] = useState<Partial<Record<BandKey, boolean>>>({});
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

  const bands = {} as Record<BandKey, ParameterBand | null>;
  const issues = {} as Record<BandKey, string | null>;
  for (const key of KEYS) {
    const band = parseBand(key, draft[key]);
    bands[key] = band;
    issues[key] = band ? bandIssue(key, band) : 'Enter each limit as a number.';
  }
  const canSave = KEYS.every((key) => !issues[key]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiClient.put<ThresholdBands>('/water/threshold-bands', bands as unknown as ThresholdBands);
      setDraft(toDraft(response.data));
      setSaved(true);
      setNotice('Thresholds saved. Overview and Parameters use them on the next refresh.');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to save thresholds.'));
    } finally {
      setPending(false);
    }
  };

  const edited = () => {
    setSaved(false);
    setNotice(null);
  };

  const setField = (key: BandKey, name: keyof ParameterBand, value: string) => {
    setDraft((current) => ({ ...current, [key]: { ...current[key], [name]: value } }));
    edited();
  };

  const applyRecommended = (key: BandKey) => {
    setDraft((current) => ({ ...current, [key]: toBandDraft(DEFAULT_THRESHOLD_BANDS[key]) }));
    edited();
  };

  const applyRecommendedToAll = () => {
    setDraft(toDraft(DEFAULT_THRESHOLD_BANDS));
    edited();
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

  const disabled = loading || pending;

  const numberField = (key: BandKey, name: keyof ParameterBand, id: string, label: string) => (
    <div>
      <label className="field-label" htmlFor={`${key}-${id}`}>{label}</label>
      <input id={`${key}-${id}`} className="field num" inputMode="decimal" disabled={disabled} value={draft[key][name]} onChange={(event) => setField(key, name, event.target.value)} />
    </div>
  );

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-5">
      <PageHead
        title="Thresholds"
        description="Set the normal range for each reading. Only calibrated, stable readings get a Normal, Warning, or Alert mark."
        meta={saved
          ? <StateMark state="ok" className="!text-sm !font-semibold">Saved</StateMark>
          : !loading ? <StateMark state="warn" className="!text-sm !font-semibold">Not saved</StateMark> : undefined}
        actions={<button type="button" className="btn-secondary btn-sm" disabled={disabled} onClick={applyRecommendedToAll}>Use recommended for all</button>}
      />

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {KEYS.map((key) => {
          const copy = COPY[key];
          const band = bands[key];
          const issue = issues[key];
          const value = liveValue(key);
          const level = band && !issue && value != null ? bandLabel(classifyBand(value, band)) : null;
          // A broken limit may be hidden, so keep the alert fields in view until it is fixed.
          const showAlerts = Boolean(alertsOpen[key] || issue);
          const isRecommended = band != null && sameBand(band, DEFAULT_THRESHOLD_BANDS[key]);
          const unitSuffix = copy.unit ? ` (${copy.unit})` : '';
          return (
            <Panel
              key={key}
              title={copy.label}
              description={`Recommended: ${recommendedText(key)}`}
              actions={level
                ? <StateMark state={markState(level)} className="!text-xs">{`${value!.toFixed(copy.digits)} · ${level}`}</StateMark>
                : <span className="text-xs text-ink-3">No calibrated reading</span>}
            >
              <div className="space-y-3">
                {copy.highOnly
                  ? numberField(key, 'normalMax', 'normal-max', `Normal up to${unitSuffix}`)
                  : (
                    <div className="grid grid-cols-2 gap-3">
                      {numberField(key, 'normalMin', 'normal-min', `Normal from${unitSuffix}`)}
                      {numberField(key, 'normalMax', 'normal-max', `Normal to${unitSuffix}`)}
                    </div>
                  )}

                {issue
                  ? <p className="text-[13px] leading-relaxed text-alarm" role="alert">{issue}</p>
                  : band && <p className="text-[13px] leading-relaxed text-ink-2">{alertSummary(key, band)}</p>}

                {showAlerts && (
                  <div className={copy.highOnly ? '' : 'grid grid-cols-2 gap-3'}>
                    {!copy.highOnly && numberField(key, 'alertMin', 'alert-min', 'Alert below')}
                    {numberField(key, 'alertMax', 'alert-max', 'Alert above')}
                  </div>
                )}

                {copy.hint && <p className="text-xs leading-relaxed text-ink-3">{copy.hint}</p>}

                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {!issue && (
                    <button type="button" className="link text-[13px]" aria-expanded={showAlerts} onClick={() => setAlertsOpen((current) => ({ ...current, [key]: !current[key] }))}>
                      {showAlerts ? 'Hide alert limits' : 'Change alert limits'}
                    </button>
                  )}
                  {!isRecommended && (
                    <button type="button" className="link text-[13px]" disabled={disabled} onClick={() => applyRecommended(key)}>Use recommended</button>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={disabled || !canSave}>
          {pending ? 'Saving…' : 'Save thresholds'}
        </button>
        <p className="max-w-3xl text-xs leading-relaxed text-ink-3">
          Saving updates the marks on Overview, Parameters, and Water change. SMS alerts use their own built-in limits, so a change here does not change a text. ORP, tank level, and the NH₃ fraction have no limits here. Dissolved oxygen is not measured on this station.
        </p>
      </div>

      {error && <Notice tone="alarm" title="Thresholds">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
    </form>
  );
};

export default DashboardThresholdsPage;
