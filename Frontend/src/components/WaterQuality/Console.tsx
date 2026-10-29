import type { ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Shared building blocks for the dashboard console. Visual language: hairline
// panels on white, state shown as a printed mark (shape + colour), and charts
// that draw guidance ranges as shaded depth bands.

export type MarkState = 'ok' | 'trust' | 'warn' | 'alarm' | 'off' | 'info';

const markColor: Record<MarkState, string> = {
  ok: 'text-ok',
  trust: 'text-note',
  warn: 'text-warn',
  alarm: 'text-alarm',
  off: 'text-ink-3',
  info: 'text-sounding',
};

// Each state also has its own shape so it reads without colour.
const MarkGlyph = ({ state }: { state: MarkState }) => {
  const common = 'h-2.5 w-2.5 shrink-0';
  switch (state) {
    case 'ok':
      return <svg viewBox="0 0 10 10" className={common} aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>;
    case 'trust':
      return <svg viewBox="0 0 10 10" className={common} aria-hidden="true"><path d="M5 1 9 5 5 9 1 5Z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
    case 'warn':
      return <svg viewBox="0 0 10 10" className={common} aria-hidden="true"><path d="M5 1.2 9.2 8.8H.8Z" fill="currentColor" /></svg>;
    case 'alarm':
      return <svg viewBox="0 0 10 10" className={common} aria-hidden="true"><rect x="1" y="1" width="8" height="8" fill="currentColor" /></svg>;
    case 'info':
      return <svg viewBox="0 0 10 10" className={common} aria-hidden="true"><circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="5" cy="5" r="1.4" fill="currentColor" /></svg>;
    default:
      return <svg viewBox="0 0 10 10" className={common} aria-hidden="true"><circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>;
  }
};

export const StateMark = ({ state, children, className = '' }: { state: MarkState; children: ReactNode; className?: string }) => (
  <span className={`inline-flex items-start gap-1.5 self-start text-[13px] font-medium leading-snug ${markColor[state]} ${className}`}>
    <span className="flex h-[1.375em] shrink-0 items-center"><MarkGlyph state={state} /></span>
    <span>{children}</span>
  </span>
);

export const PageHead = ({ title, description, meta, actions }: { title: string; description?: ReactNode; meta?: ReactNode; actions?: ReactNode }) => (
  <header className="flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
    <div className="min-w-0">
      <h1 className="text-[22px] font-semibold leading-tight sm:text-2xl">{title}</h1>
      {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-2">{description}</p>}
    </div>
    {(meta || actions) && (
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        {meta}
        {actions}
      </div>
    )}
  </header>
);

export const MetaItem = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <p className="text-xs text-ink-3">{label}</p>
    <div className="num mt-0.5 text-sm font-semibold text-ink">{children}</div>
  </div>
);

export const Panel = ({ title, description, actions, children, className = '', bodyClassName = 'p-4 sm:p-5', id }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) => (
  <section className={`panel flex min-w-0 flex-col ${className}`} aria-labelledby={id}>
    {(title || actions) && (
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          {title && <h2 id={id} className="text-[15px] font-semibold leading-snug">{title}</h2>}
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
    <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
  </section>
);

export const KeyValues = ({ rows, className = '' }: { rows: Array<{ label: ReactNode; value: ReactNode }>; className?: string }) => (
  <dl className={`divide-y divide-line-soft text-sm ${className}`}>
    {rows.map((row, index) => (
      <div key={index} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
        <dt className="text-ink-2">{row.label}</dt>
        <dd className="num text-right font-medium text-ink">{row.value}</dd>
      </div>
    ))}
  </dl>
);

export const Notice = ({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'alarm' | 'ok'; title?: ReactNode; children: ReactNode }) => {
  const styles = {
    info: 'border-line bg-water text-ink-2',
    warn: 'border-warn/25 bg-warn-bg text-[#6b3504]',
    alarm: 'border-alarm/25 bg-alarm-bg text-[#7a1a12]',
    ok: 'border-ok/25 bg-[#e9f5ee] text-[#154f35]',
  }[tone];
  return (
    <div role={tone === 'alarm' ? 'alert' : 'status'} className={`rounded-md border px-3.5 py-2.5 text-[13px] leading-relaxed ${styles}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
};

// One plain-language treatment for a lost live connection, used across pages.
export const ConnectionNotice = ({ isConnected, error }: { isConnected: boolean; error?: string | null }) => {
  if (!isConnected) {
    return <Notice tone="alarm" title="Live connection lost">Check that the AquaSense server is running. Readings appear again once it reconnects and the device is sending.</Notice>;
  }
  return error ? <Notice tone="warn" title="Data connection">{error}</Notice> : null;
};

export const EmptyState =({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="rounded-md border border-dashed border-line px-4 py-6 text-center">
    <p className="text-sm font-semibold text-ink">{title}</p>
    {children && <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-ink-3">{children}</p>}
  </div>
);

// Shared device picker used by the feeder, pump and aerator pages.
export const DeviceSelect = ({ id, value, devices, onChange }: {
  id: string;
  value: string;
  devices: Array<{ deviceId: string; name?: string }>;
  onChange: (deviceId: string) => void;
}) => (
  <div>
    <label className="field-label" htmlFor={id}>Device</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="field">
      {devices.length === 0 && <option value="">No active registered device</option>}
      {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.name || device.deviceId} ({device.deviceId})</option>)}
    </select>
  </div>
);

type ChartPoint = { time: string };

// Time series on a hydrographic grid. When a guidance range exists it is drawn
// as a shaded band with dashed contour edges; values outside it fall on shoal tint.
export const BandChart = ({ data, dataKey, domain, band, unit = '', digits = 1, emptyText = 'No samples reported yet', height = 180, label }: {
  data: ChartPoint[];
  dataKey: string;
  domain: [number | 'auto', number | 'auto'];
  band?: [number, number];
  unit?: string;
  digits?: number;
  emptyText?: string;
  height?: number;
  label: string;
}) => {
  const hasData = data.some((point) => {
    const value = (point as Record<string, unknown>)[dataKey];
    return typeof value === 'number' && Number.isFinite(value);
  });
  const [min, max] = domain;
  const fixed = typeof min === 'number' && typeof max === 'number';
  return (
    <div className="relative" style={{ height }} role="img" aria-label={hasData ? `${label} trend chart` : `${label}: ${emptyText}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          {band && fixed && <ReferenceArea y1={min} y2={band[0]} fill="#f1e9d2" fillOpacity={0.6} stroke="none" ifOverflow="hidden" />}
          {band && fixed && <ReferenceArea y1={band[1]} y2={max} fill="#f1e9d2" fillOpacity={0.6} stroke="none" ifOverflow="hidden" />}
          {band && <ReferenceArea y1={band[0]} y2={band[1]} fill="#e1eef6" fillOpacity={1} stroke="#7aaecb" strokeDasharray="4 3" strokeWidth={1} ifOverflow="hidden" />}
          <CartesianGrid vertical={false} stroke="#e8eff4" />
          <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#5b7083' }} tickLine={false} axisLine={{ stroke: '#d6e2ea' }} tickMargin={6} minTickGap={28} />
          <YAxis domain={domain} tick={{ fontSize: 11, fill: '#5b7083' }} axisLine={false} tickLine={false} width={40} allowDecimals
            tickFormatter={(value: number) => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(Math.min(digits, 2)))))} />
          <Tooltip
            cursor={{ stroke: '#7aaecb', strokeWidth: 1 }}
            contentStyle={{ background: '#ffffff', border: '1px solid #d6e2ea', borderRadius: 6, boxShadow: '0 8px 24px -6px rgba(15,42,61,0.18)', fontSize: 12, padding: '6px 10px' }}
            labelStyle={{ color: '#5b7083', marginBottom: 2 }}
            itemStyle={{ color: '#0f2a3d', fontVariantNumeric: 'tabular-nums' }}
            formatter={(value) => [`${Number(value).toFixed(digits)}${unit ? ` ${unit}` : ''}`, label]}
          />
          <Line type="monotone" dataKey={dataKey} stroke="#0f2a3d" strokeWidth={1.6} dot={false} activeDot={{ r: 3.5, fill: '#0f2a3d', stroke: '#fff', strokeWidth: 1.5 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      {!hasData && (
        <div className="absolute inset-0 grid place-items-center pl-8">
          <p className="rounded bg-white/90 px-2 py-1 text-[13px] text-ink-3">{emptyText}</p>
        </div>
      )}
    </div>
  );
};

// A chart frame: title and guidance on one line, the chart, then a printed note.
export const ChartPanel = ({ title, guidance, note, children, className = '' }: { title: string; guidance?: ReactNode; note?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`panel flex min-w-0 flex-col px-4 pb-3 pt-3.5 ${className}`}>
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="truncate text-sm font-semibold">{title}</h3>
      {guidance && <span className="shrink-0 text-xs text-ink-3">{guidance}</span>}
    </div>
    {children}
    {note && <p className="mt-2 text-xs leading-relaxed text-ink-3">{note}</p>}
  </section>
);

export const BandKey = () => (
  <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] border border-dashed border-contour bg-band" />Guidance range</span>
    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] bg-shoal" />Outside range</span>
  </span>
);
