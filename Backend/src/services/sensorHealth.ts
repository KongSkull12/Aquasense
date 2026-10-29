// Technical diagnostics, deliberately separate from husbandry thresholds.
export const SENSOR_NAMES = ['temperature', 'ph', 'turbidity', 'orp'] as const;
export type SensorName = typeof SENSOR_NAMES[number];
export type HealthState = 'VALID' | 'INVALID' | 'SENSOR_ERROR' | 'MISSING' | 'STALE' | 'UNSTABLE' | 'SATURATED' | 'POSSIBLY_STUCK';
export interface SensorHealth {
  name: SensorName; value: number | null; rawAdc: number | null; voltage: number | null;
  adcMinimum: number|null; adcMaximum: number|null; adcLast: number|null; clippedSamples: number|null;
  unit: string; timestamp: string | null; health: HealthState; valid: boolean;
  rawAvailable: boolean; measurementValid: boolean;
  stability: 'COLLECTING' | 'STABLE' | 'UNSTABLE'; calibration: 'REQUIRED' | 'CALIBRATED';
  reason: string; readyForCalibration: boolean; communication: boolean;
  adcRange: 'PASS' | 'WARNING' | 'UNKNOWN'; stuckDurationMs: number;
  window: { count: number; min: number | null; max: number | null; average: number | null; range: number | null; standardDeviation: number | null };
}
export interface UltrasonicReading {
  connected: boolean;
  valid: boolean;
  distanceCm: number | null;
  levelPercent: number | null;
  timestamp: string | null;
  reason: string;
}
export type HealthSummary = Record<SensorName, SensorHealth>;
export type ExtendedHealthSummary = HealthSummary & { ultrasonic?: UltrasonicReading };
export const HEALTH_CONFIG = { staleMs: 15000, tanMaxAgeMs: 3600000, windowSize: 20, minSamples: 6, windowMs: 150000, stuckMs: 600000, railSamples: 3 };
const noise = { temperature: 1, ph: 0.3, turbidity: 150, orp: 50 }; // Diagnostic ranges, not calibration coefficients.
export function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return null;
  const result = Number(value); return Number.isFinite(result) ? result : null;
}
export function timestampMs(value: unknown): number {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : NaN;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 1_000_000_000_000 && value <= 4_102_444_800_000 ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const parts=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!parts) return NaN;
  const calendar=new Date(Date.UTC(Number(parts[1]),Number(parts[2])-1,Number(parts[3]),Number(parts[4]),Number(parts[5]),Number(parts[6])));
  if (calendar.getUTCFullYear()!==Number(parts[1]) || calendar.getUTCMonth()!==Number(parts[2])-1 || calendar.getUTCDate()!==Number(parts[3]) || calendar.getUTCHours()!==Number(parts[4]) || calendar.getUTCMinutes()!==Number(parts[5]) || calendar.getUTCSeconds()!==Number(parts[6])) return NaN;
  const at=Date.parse(value);
  return Number.isFinite(at) ? at : NaN;
}
type Sample = { value: number; at: number };
type Track = { samples: Sample[]; lastAt: number; anchor: number; unchangedSince: number; rails: number; railSide: number };
export class SensorValidator {
  private tracks = new Map<string, Track>();
  constructor(private config = HEALTH_CONFIG) {}
  validate(device: string, name: SensorName, input: unknown, timestamp: unknown, diagnostics: any = {}, now = Date.now(), unit?: string): SensorHealth {
    const value = numeric(input), at = timestampMs(timestamp);
    const rawAdc = numeric(diagnostics?.rawAdc), voltage = numeric(diagnostics?.voltage);
    const result: SensorHealth = { name, value, rawAdc, voltage, unit: unit || ({temperature:'C',ph:'pH',turbidity:'unknown',orp:'mV'}[name]),
      adcMinimum:numeric(diagnostics?.adcMinimum),adcMaximum:numeric(diagnostics?.adcMaximum),adcLast:numeric(diagnostics?.adcLast),clippedSamples:numeric(diagnostics?.clippedSamples),
      timestamp: Number.isFinite(at) ? new Date(at).toISOString() : null, health:'VALID', valid:true, rawAvailable:rawAdc!==null, measurementValid:value!==null,
      stability:'COLLECTING', calibration:'REQUIRED', reason:'', readyForCalibration:false, communication:value !== null || rawAdc !== null,
      adcRange:rawAdc === null ? 'UNKNOWN' : 'PASS', stuckDurationMs:0,
      window:{count:0,min:null,max:null,average:null,range:null,standardDeviation:null} };
    const fail = (health: HealthState, reason: string) => { result.health = health; result.valid = false; result.reason = reason; };
    const key = `${device}:${name}`;
    let track = this.tracks.get(key);
    if (!track) { track = {samples:[],lastAt:-Infinity,anchor:NaN,unchangedSince:now,rails:0,railSide:0}; this.tracks.set(key,track); }
    const rawOnly = value === null && rawAdc !== null && name !== 'temperature';
    if (rawOnly) fail('MISSING','Raw signal available; engineering conversion is unavailable');
    else if (input === null || input === undefined) fail('MISSING','No sensor reading supplied');
    else if (value === null) fail('INVALID','Malformed or non-finite reading');
    else if (name === 'temperature' && value === -127) fail('SENSOR_ERROR','DS18B20 disconnected/error reading detected');
    else if ((name === 'temperature' && (value < -55 || value > 125)) || (name === 'ph' && (value < 0 || value > 14)) ||
      (name === 'turbidity' && (value < 0 || (unit === 'raw_adc' && value > 4095)))) fail('INVALID','Outside sensor physical range');
    // Device-supplied flags cannot authorize a calibration the backend has not commissioned.
    if (name==='orp' && (value!==null || rawAdc!==null) && (result.calibration!=='CALIBRATED' || diagnostics?.conversion!=='VALIDATED')) fail('MISSING','ORP engineering conversion/calibration is not commissioned by the backend');
    if (!Number.isFinite(at) || at > now + 2000) fail('INVALID','Invalid or future acquisition timestamp');
    else if (now - at > this.config.staleMs) fail('STALE','No recent sensor reading received');
    if ((diagnostics?.rawAdc != null && rawAdc === null) || (rawAdc !== null && (rawAdc < 0 || rawAdc > 4095)) ||
      (diagnostics?.voltage != null && voltage === null) || (voltage !== null && (voltage < 0 || voltage > 3.3))) fail('INVALID','Malformed or out-of-range ADC/input voltage');
    if (diagnostics?.connected === false) fail('SENSOR_ERROR','Device reports sensor disconnected; value is diagnostic only');
    else if (diagnostics?.valid === false) fail('INVALID','Device reports this sample as invalid; value is diagnostic only');
    if (at < track.lastAt && result.valid) fail('STALE','Out-of-order acquisition');
    const freshSample = Number.isFinite(at) && at > track.lastAt && now - at <= this.config.staleMs && at <= now + 2000;
    if (freshSample) {
      if (at - track.lastAt > this.config.staleMs) { track.samples=[]; track.rails=0; track.anchor=NaN; }
      track.lastAt=at;
      const side = rawAdc === null ? 0 : rawAdc <= 8 ? -1 : rawAdc >= 4087 ? 1 : (result.clippedSamples ?? 0)>=8 ? 2 : 0;
      track.rails = side && side === track.railSide ? track.rails+1 : side ? 1 : 0; track.railSide=side;
      if (result.valid && (value !== null || rawOnly)) {
        track.samples = [...track.samples.filter(s => at-s.at <= this.config.windowMs),{value:rawOnly ? rawAdc! : value!,at}].slice(-this.config.windowSize);
        const signal = rawAdc ?? value!;
        if (!Number.isFinite(track.anchor) || Math.abs(signal-track.anchor) > (rawAdc === null ? 0.001 : 1)) { track.anchor=signal; track.unchangedSince=at; }
        result.stuckDurationMs = at-track.unchangedSince;
      } else { track.samples=[]; track.anchor=NaN; }
    }
    // A repeated acquisition must retain its original diagnostic state.
    if (Number.isFinite(track.anchor) && at === track.lastAt) result.stuckDurationMs = at-track.unchangedSince;
    const values = track.samples.map(s=>s.value);
    if (values.length) {
      const min=Math.min(...values),max=Math.max(...values),average=values.reduce((a,b)=>a+b,0)/values.length;
      result.window={count:values.length,min,max,average,range:max-min,standardDeviation:Math.sqrt(values.reduce((s,v)=>s+(v-average)**2,0)/values.length)};
      if (values.length >= this.config.minSamples) result.stability=max-min > (rawOnly ? noise.turbidity : noise[name]) ? 'UNSTABLE' : 'STABLE';
    }
    // One clipped conversion in an averaged burst is diagnostic only.
    // Repeated rail readings remain invalidated by the independent-sample rule below.
    if (result.health !== 'STALE' && track.rails >= this.config.railSamples) { fail('SATURATED',`ADC repeatedly near ${track.railSide < 0 ? 'minimum':'maximum'} range`); result.adcRange='WARNING'; }
    // Firmware may detect errors at its faster acquisition rate; it cannot grant validity or calibration.
    if (result.health !== 'STALE' && ['SENSOR_ERROR','SATURATED','INVALID','UNSTABLE','POSSIBLY_STUCK'].includes(diagnostics?.health)) fail(diagnostics.health,`Device reported ${diagnostics.health}`);
    // A plausible step can be a real water event. Preserve its value for inspection,
    // but prohibit calibration and automatic decisions until it is stable.
    if (result.valid && result.stability === 'UNSTABLE') { result.health='UNSTABLE'; result.reason='Large recent variation; inspect signal and water conditions'; }
    if (result.valid && result.stuckDurationMs >= this.config.stuckMs) fail('POSSIBLY_STUCK',`Nearly unchanged for ${result.stuckDurationMs} ms; stable water is also possible`);
    if (result.health==='SENSOR_ERROR') result.communication=false;
    result.readyForCalibration=result.valid && result.stability==='STABLE' && (name==='temperature' || result.adcRange==='PASS' && voltage !== null && diagnostics?.voltageSource === 'EFUSE');
    result.measurementValid=result.valid && value!==null;
    if (this.tracks.size > 2048) this.tracks.delete(this.tracks.keys().next().value!);
    return result;
  }
}
export function refreshHealth(summary: ExtendedHealthSummary, now = Date.now(), staleMs = HEALTH_CONFIG.staleMs): ExtendedHealthSummary {
  const refreshed = Object.fromEntries(SENSOR_NAMES.map(name=> { const s=summary[name]; const at=timestampMs(s?.timestamp);
    if (!s) return [name,new SensorValidator().validate('missing',name,null,null,{},now)];
    return [name, !Number.isFinite(at) || at>now+2000 || now-at>staleMs ? {...s,health:'STALE',valid:false,measurementValid:false,readyForCalibration:false,reason:'No valid recent acquisition timestamp'} : {...s}]; })) as unknown as ExtendedHealthSummary;
  if (summary.ultrasonic) {
    const sample = summary.ultrasonic;
    const at = timestampMs(sample.timestamp);
    const fresh = Number.isFinite(at) && at <= now + 2000 && now - at <= staleMs;
    refreshed.ultrasonic = fresh ? { ...sample } : {
      ...sample, valid: false, distanceCm: null, levelPercent: null,
      reason: 'No recent ultrasonic reading',
    };
  }
  return refreshed;
}
export function decisionEligible(summary?: HealthSummary): boolean {
  if (!summary) return false;
  const health=refreshHealth(summary);
  return SENSOR_NAMES.every(name=>health[name].valid && health[name].health==='VALID' && health[name].stability==='STABLE' && health[name].calibration==='CALIBRATED');
}
export interface TanMeasurement { value: number; unit: 'mg/L as N'; source: 'test_kit'|'laboratory'|'external_sensor'|'manual'; validated: true; timestamp: string }
export function ammoniaSpeciation(health: HealthSummary, tan?: unknown, waterType = 'freshwater', now = Date.now()) {
  const sources=refreshHealth(health,now), temperature=sources.temperature, ph=sources.ph;
  const result = { status:'UNAVAILABLE', pKa:null as number|null, fraction:null as number|null, percent:null as number|null,
    tan:null as TanMeasurement|null, nh3N:null as number|null, concentrationUnit:'mg/L as N', confidence:'PRELIMINARY / CALIBRATION REQUIRED',
    sourceCalibration:{temperature:temperature.calibration,ph:ph.calibration}, waterType,
    reason:'Valid and fresh pH and temperature readings are required', concentrationReason:'Actual ammonia concentration requires a valid TAN measurement' };
  const t=tan as TanMeasurement | undefined;
  if (t && typeof t.value==='number' && Number.isFinite(t.value) && t.value>=0 && t.unit==='mg/L as N' && t.validated===true &&
    ['test_kit','laboratory','external_sensor','manual'].includes(t.source) && Number.isFinite(timestampMs(t.timestamp)) &&
    now-timestampMs(t.timestamp)<=HEALTH_CONFIG.tanMaxAgeMs && timestampMs(t.timestamp)<=now+2000) {
    result.tan=t; result.concentrationReason='TAN available; valid source sensors and freshwater conditions are also required';
  }
  const qualified = (source: SensorHealth) => source.valid && source.health==='VALID' && source.stability==='STABLE' && source.calibration==='CALIBRATED';
  if (!qualified(temperature) || !qualified(ph) || temperature.value === null || ph.value === null) {
    const reason = [temperature,ph].find(source=>source.health==='UNSTABLE') ? 'Stable pH and temperature are required' :
      [temperature,ph].find(source=>source.calibration!=='CALIBRATED') ? 'Calibrated pH and temperature are required' : result.reason;
    return {...result,reason};
  }
  if (waterType !== 'freshwater') return {...result,reason:'Freshwater equation requires freshwater conditions; salinity correction is not implemented'};
  if (temperature.value < 0 || temperature.value > 50) return {...result,reason:'Outside freshwater speciation temperature domain (0–50 C)'};
  result.pKa=0.09018+2729.92/(273.2+temperature.value);
  result.fraction=1/(1+10**(result.pKa-ph.value)); result.percent=result.fraction*100; result.status='AVAILABLE';
  result.reason='Fraction of TAN only; source-sensor accuracy has not been formally verified';
  if (result.tan) {
    const tanAt=timestampMs(result.tan.timestamp);
    const temperatureAt=timestampMs(temperature.timestamp);
    const phAt=timestampMs(ph.timestamp);
    const aligned=Math.abs(tanAt-temperatureAt)<=HEALTH_CONFIG.staleMs &&
      Math.abs(tanAt-phAt)<=HEALTH_CONFIG.staleMs &&
      Math.abs(temperatureAt-phAt)<=HEALTH_CONFIG.staleMs;
    if (aligned) {
      result.nh3N=result.tan.value*result.fraction;
      result.concentrationReason='NH3-N calculated from time-aligned measured TAN, pH and temperature (mg/L as N)';
    } else {
      result.concentrationReason='TAN, pH and temperature acquisition times must be within 15 seconds to calculate NH3-N';
    }
  }
  return result;
}
export type AmmoniaSpeciation = ReturnType<typeof ammoniaSpeciation>;
