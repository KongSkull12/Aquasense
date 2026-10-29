import type { ReactNode } from 'react';

type Tone = 'emerald' | 'cyan' | 'amber' | 'rose' | 'violet' | 'slate';

const toneStyles: Record<Tone, { chip: string; border: string; text: string; dot: string }> = {
  emerald: {
    chip: 'bg-emerald-500/15 text-emerald-300',
    border: 'border-emerald-500/25',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
  },
  cyan: {
    chip: 'bg-cyan-500/15 text-cyan-300',
    border: 'border-cyan-500/25',
    text: 'text-cyan-300',
    dot: 'bg-cyan-400',
  },
  amber: {
    chip: 'bg-amber-500/15 text-amber-300',
    border: 'border-amber-500/25',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
  },
  rose: {
    chip: 'bg-rose-500/15 text-rose-300',
    border: 'border-rose-500/25',
    text: 'text-rose-300',
    dot: 'bg-rose-400',
  },
  violet: {
    chip: 'bg-violet-500/15 text-violet-300',
    border: 'border-violet-500/25',
    text: 'text-violet-300',
    dot: 'bg-violet-400',
  },
  slate: {
    chip: 'bg-slate-500/15 text-slate-300',
    border: 'border-white/10',
    text: 'text-slate-300',
    dot: 'bg-slate-400',
  },
};

export const IconBadge = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneStyles[tone].chip}`}>{children}</span>
);

export const PageHeader = ({ title, subtitle, tone, icon }: { title: string; subtitle?: string; tone: Tone; icon: ReactNode }) => (
  <header className={`rounded-2xl border bg-gradient-to-r from-[#1a1b22] to-[#121317] p-5 ${toneStyles[tone].border}`}>
    <h2 className="flex items-center gap-3 text-2xl font-bold text-white">
      <IconBadge tone={tone}>{icon}</IconBadge>
      <span>{title}</span>
    </h2>
    {subtitle && <p className="mt-2 text-sm text-gray-400">{subtitle}</p>}
  </header>
);

export const Panel = ({ title, tone, icon, children }: { title: string; tone: Tone; icon?: ReactNode; children: ReactNode }) => (
  <section className="rounded-xl border border-white/10 bg-[#14151b] p-4">
    <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
      <span className={`inline-block h-2 w-2 rounded-full ${toneStyles[tone].dot}`} />
      {icon}
      <span>{title}</span>
    </h3>
    {children}
  </section>
);

export const MetricCard = ({ label, value, detail, tone, icon }: { label: string; value: string; detail?: string; tone: Tone; icon: ReactNode }) => (
  <div className={`rounded-xl border bg-[#14151b] p-4 ${toneStyles[tone].border}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`mt-2 text-3xl font-bold ${toneStyles[tone].text}`}>{value}</p>
      </div>
      <IconBadge tone={tone}>{icon}</IconBadge>
    </div>
    {detail && <p className="mt-2 text-xs text-gray-500">{detail}</p>}
  </div>
);

export const StatusBadge = ({ label, tone }: { label: string; tone: Tone }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${toneStyles[tone].chip}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${toneStyles[tone].dot}`} />
    {label}
  </span>
);

export const DashboardIcon = ({ name }: { name: 'home' | 'chart' | 'feed' | 'alert' | 'battery' | 'tank' | 'pulse' | 'sms' | 'clock' | 'bell' | 'settings' | 'user' | 'aerator' | 'drain' | 'fill' }) => {
  const common = 'h-4 w-4 fill-none stroke-current';
  switch (name) {
    case 'home':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M3 12l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>;
    case 'chart':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M4 19h16" /><path d="M7 15l3-3 2 2 5-6" /></svg>;
    case 'feed':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M12 3v18" /><path d="M5 8h14" /><path d="M7 13h10" /><path d="M9 18h6" /></svg>;
    case 'alert':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4.8L2.9 18a1 1 0 0 0 .9 1.5h16.4a1 1 0 0 0 .9-1.5L13.7 4.8a1 1 0 0 0-1.8 0z" /></svg>;
    case 'battery':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M4 8h14v8H4z" /><path d="M20 11v2" /><path d="M7 11h5" /></svg>;
    case 'tank':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M5 7c0-2 14-2 14 0v10c0 2-14 2-14 0z" /><path d="M5 7c0 2 14 2 14 0" /><path d="M8 14h8" /></svg>;
    case 'pulse':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;
    case 'sms':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M4 5h16v12H7l-3 3z" /><path d="M8 9h8" /><path d="M8 13h5" /></svg>;
    case 'clock':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>;
    case 'bell':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M6 9a6 6 0 0 1 12 0c0 7 3 6 3 8H3c0-2 3-1 3-8" /><path d="M10 20h4" /></svg>;
    case 'settings':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3a8 8 0 0 0-1.7 1L5 6l-2 3.5L5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.4-1a8 8 0 0 0 1.7 1l.4 3h5l.4-3a8 8 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z" /></svg>;
    case 'user':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    case 'aerator':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><circle cx="12" cy="12" r="2" /><path d="M12 4c2 3 2 5 0 8" /><path d="M20 12c-3 2-5 2-8 0" /><path d="M12 20c-2-3-2-5 0-8" /><path d="M4 12c3-2 5-2 8 0" /></svg>;
    case 'drain':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M5 4c0-1 14-1 14 0v9c0 4-14 4-14 0z" /><path d="M12 9v6" /><path d="M9 12l3 3 3-3" /></svg>;
    case 'fill':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth="2"><path d="M5 11c0-1 14-1 14 0v9c0 1-14 1-14 0z" /><path d="M12 3v8" /><path d="M9 6l3-3 3 3" /></svg>;
  }
};
