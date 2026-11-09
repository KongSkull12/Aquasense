import type { RiskAssessment, RiskLevel, RiskTrend } from '../../types/water';
import { Panel, StateMark, type MarkState } from './Console';

const levelState = (level: RiskLevel | null): MarkState =>
  level === 'Low' ? 'ok' : level === 'Moderate' ? 'warn' : level === 'High' || level === 'Extreme' ? 'alarm' : 'off';

const trendText = (trend: RiskTrend) => (trend === 'Unknown' ? 'not enough history' : trend.toLowerCase());

// The four bands of the study classification, drawn like depth bands under the score.
const BANDS: Array<{ from: number; to: number; label: RiskLevel; tint: string }> = [
  { from: 0, to: 30, label: 'Low', tint: 'bg-band' },
  { from: 30, to: 55, label: 'Moderate', tint: 'bg-shoal/60' },
  { from: 55, to: 80, label: 'High', tint: 'bg-warn-bg' },
  { from: 80, to: 100, label: 'Extreme', tint: 'bg-alarm-bg' },
];

export const RiskAssessmentPanel = ({ assessment, compact = false }: { assessment: RiskAssessment | null; compact?: boolean }) => {
  if (!assessment || assessment.status !== 'AVAILABLE' || assessment.score === null) {
    return (
      <Panel title="Mortality risk">
        <StateMark state="off" className="!text-base !font-semibold">Unavailable</StateMark>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{assessment?.reason ?? 'The risk score appears once the device is sending live readings.'}</p>
      </Panel>
    );
  }

  const { score, worstCaseScore, level, worstCaseLevel, complete } = assessment;
  const ranged = !complete && worstCaseLevel !== level;
  const levelLabel = ranged ? `${level} to ${worstCaseLevel}` : level;
  const missing = assessment.factors.filter((f) => !f.available);

  return (
    <Panel title="Mortality risk" actions={<StateMark state={levelState(ranged ? worstCaseLevel : level)}>{levelLabel}</StateMark>}>
      <div className="flex items-baseline gap-2">
        <p className="num text-[32px] font-semibold leading-none">{score}</p>
        <p className="text-sm text-ink-3">/ 100{ranged && worstCaseScore !== null ? ` · up to ${worstCaseScore} with missing inputs` : ''}</p>
      </div>

      <div className="relative mt-3 h-2.5 overflow-hidden rounded-sm" aria-hidden="true">
        <div className="absolute inset-0 flex">
          {BANDS.map((band) => <div key={band.label} className={band.tint} style={{ width: `${band.to - band.from}%` }} />)}
        </div>
        {ranged && worstCaseScore !== null && (
          <div className="absolute inset-y-0 border-y border-dashed border-ink-3/60" style={{ left: `${score}%`, width: `${Math.max(0, worstCaseScore - score)}%` }} />
        )}
        <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${Math.max(score, 1)}%` }} />
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-ink-3"><span>0</span><span>30</span><span>55</span><span>80</span><span>100</span></div>

      {ranged && (
        <p className="mt-3 text-[13px] leading-relaxed text-warn">
          Incomplete: {missing.map((f) => f.label.toLowerCase()).join(' and ')} {missing.length > 1 ? 'are' : 'is'} not measured, so the real risk could be as high as {worstCaseLevel}.
        </p>
      )}

      {!compact && (
        <>
          <dl className="mt-4 divide-y divide-line-soft border-t border-line-soft text-[13px]">
            {assessment.factors.map((factor) => (
              <div key={factor.key} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="min-w-0">
                  <span className="text-ink">{factor.label}</span>
                  {factor.provisional && <span className="ml-1.5 text-xs text-note">provisional</span>}
                  <span className="block truncate text-xs text-ink-3">{factor.available
                    ? `${factor.value === null ? '' : `${Number(factor.value.toFixed(2))}${factor.unit ? ` ${factor.unit}` : ''} · `}${factor.detail}`
                    : factor.detail}</span>
                </dt>
                <dd className="num shrink-0 text-right">
                  {factor.available
                    ? <span className={factor.points > 0 ? 'font-semibold text-ink' : 'text-ink-3'}>{factor.points} <span className="text-ink-3">/ {factor.maxPoints}</span></span>
                    : <span className="text-ink-3">missing</span>}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            Temperature {trendText(assessment.trends.temperature)} · ORP {trendText(assessment.trends.orp)} · ammonia {trendText(assessment.trends.ammonia)}
            {assessment.violationMinutes !== null ? ` · ${assessment.violationMinutes} min out of range` : ''}
          </p>
        </>
      )}

      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        Rule-based score from the study's risk-scoring + trend model, adapted to AquaSense sensors. Not validated against field mortality{assessment.inputsUncalibrated ? '; sensor inputs are not yet calibrated' : ''}. It is not a probability.
      </p>
    </Panel>
  );
};
