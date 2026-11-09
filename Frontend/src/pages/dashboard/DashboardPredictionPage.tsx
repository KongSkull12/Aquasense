import { Notice, PageHead, Panel, StateMark } from '../../components/WaterQuality/Console';

/**
 * Comparison of the three AquaSense mortality-risk rules on the study set
 * (500 labeled crayfish rows). Formulas match docs/evaluation/evaluate_risk_models.py
 * and Backend/src/services/riskScoring.ts. Accuracy is an exact four-class match.
 * Precision, recall, and F1 treat High and Extreme as the danger class.
 * The cross-validated F1 is that danger F1 on five shuffled folds (seed 42);
 * the rules are fixed, so the folds only change which rows are scored.
 * Computed 1 Nov 2026. This page does not retrain anything.
 */

const LABELS = ['Low', 'Moderate', 'High', 'Extreme'] as const;

interface ModelRow {
  name: string;
  live?: boolean;
  accuracy: string;
  precision: string;
  recall: string;
  f1: string;
  cvF1: string;
  matrix: number[][];
  settings: string;
}

const MODELS: ModelRow[] = [
  {
    name: 'Threshold-based',
    accuracy: '49.8%',
    precision: '81.5%',
    recall: '88.7%',
    f1: '85.0%',
    cvF1: '85.0% ± 2.2',
    matrix: [
      [1, 5, 2, 0],
      [14, 44, 49, 22],
      [1, 38, 79, 77],
      [0, 2, 41, 125],
    ],
    settings: 'One point each: dissolved oxygen below 4.5 mg/L, ammonia above 2.0 mg/L, temperature above 32 °C, pH outside 6.5–8.5, turbidity above 70 NTU. Zero points is Low, one is Moderate, two is High, three or more is Extreme.',
  },
  {
    name: 'Risk scoring',
    accuracy: '68.0%',
    precision: '94.8%',
    recall: '85.7%',
    f1: '90.0%',
    cvF1: '89.9% ± 3.4',
    matrix: [
      [7, 1, 0, 0],
      [29, 83, 17, 0],
      [2, 50, 125, 18],
      [0, 0, 43, 125],
    ],
    settings: 'Points for dissolved oxygen, ammonia, temperature, pH, turbidity, and minutes out of range. Cuts at 30, 55, and 80 map the score to Low, Moderate, High, and Extreme.',
  },
  {
    name: 'Risk scoring + trend',
    live: true,
    accuracy: '77.6%',
    precision: '89.0%',
    recall: '98.3%',
    f1: '93.5%',
    cvF1: '93.5% ± 1.1',
    matrix: [
      [6, 2, 0, 0],
      [5, 80, 44, 0],
      [0, 6, 135, 54],
      [0, 0, 1, 167],
    ],
    settings: 'Same points as risk scoring, plus 8 for falling oxygen, 8 for rising ammonia, and 5 for rising temperature, capped at 100. Same cuts: 30, 55, 80. This is the rule on the Overview.',
  },
];

const Matrix = ({ model }: { model: ModelRow }) => (
  <Panel
    title={model.name}
    actions={model.live ? <StateMark state="ok">Live</StateMark> : undefined}
    bodyClassName="p-0"
  >
    <div className="overflow-x-auto">
      <table className="w-full min-w-[280px] text-left text-sm">
        <thead className="border-b border-line text-xs text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Actual</th>
            {LABELS.map((label) => (
              <th key={label} scope="col" className="px-2 py-2 text-right font-medium">Pred. {label === 'Moderate' ? 'Mod.' : label === 'Extreme' ? 'Ext.' : label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="num divide-y divide-line-soft">
          {model.matrix.map((row, index) => (
            <tr key={LABELS[index]}>
              <th scope="row" className="px-4 py-2 text-left text-xs font-medium text-ink-2">{LABELS[index]}</th>
              {row.map((count, column) => (
                <td key={LABELS[column]} className={`px-2 py-2 text-right ${index === column ? 'font-semibold text-ink' : 'text-ink-2'}`}>{count}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="border-t border-line-soft px-4 py-3 text-xs leading-relaxed text-ink-3">{model.settings}</p>
  </Panel>
);

const DashboardPredictionPage = () => (
  <div className="space-y-5">
    <PageHead
      title="Prediction model"
      description="Threshold-based, risk scoring, and risk scoring with trend. The live Overview uses risk scoring with trend. The table is how those fixed rules match the study labels."
    />

    <Notice tone="warn" title="Study set, scored once">
      500 labeled crayfish rows. Dissolved oxygen, ammonia, temperature, pH, turbidity, minutes out of range, and three trends. This tank has no dissolved-oxygen probe, so the live score leaves those points missing and widens the level into a range. Ammonia is included after a TAN measurement is entered. ORP can add provisional points on the Overview and is absent from this comparison.
    </Notice>

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(260px,0.8fr)]">
      <Panel title="Comparison on the study set" description="Every row is scored. Precision, recall, and F1 are for calling High or Extreme. Cross-validated F1 is the same question on five shuffled folds." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Model</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Accuracy</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Precision</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Recall</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">F1</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">CV F1</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line-soft">
              {MODELS.map((model) => (
                <tr key={model.name} className={model.live ? 'bg-water' : undefined}>
                  <th scope="row" className="px-5 py-2.5 text-left font-medium text-ink">
                    <span className="inline-flex items-center gap-2">
                      {model.name}
                      {model.live && <StateMark state="ok" className="!text-xs">Live</StateMark>}
                    </span>
                  </th>
                  <td className="px-3 py-2.5 text-right">{model.accuracy}</td>
                  <td className="px-3 py-2.5 text-right">{model.precision}</td>
                  <td className="px-3 py-2.5 text-right">{model.recall}</td>
                  <td className="px-3 py-2.5 text-right">{model.f1}</td>
                  <td className="px-5 py-2.5 text-right">{model.cvF1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line-soft px-5 py-3 text-xs leading-relaxed text-ink-3">
          Accuracy is an exact match to Low, Moderate, High, or Extreme. Precision is the share of High or Extreme calls that the study also labeled High or Extreme. Recall is the share of those study labels the rule caught. F1 balances the two.
        </p>
      </Panel>

      <Panel title="Study set" bodyClassName="p-0">
        <dl className="divide-y divide-line-soft text-sm">
          {[
            ['Source', 'Crayfish water-quality study, 500 rows'],
            ['Labels', 'Low 8 · Moderate 129 · High 195 · Extreme 168'],
            ['Folds', '5, shuffled, seed 42'],
            ['Inputs', 'Dissolved oxygen, ammonia, temperature, pH, turbidity, minutes out of range, three trends'],
            ['Cuts', '30 / 55 / 80, capped at 100'],
            ['Scored', '1 Nov 2026'],
          ].map(([label, value]) => (
            <div key={label} className="px-5 py-3">
              <dt className="text-xs text-ink-3">{label}</dt>
              <dd className="mt-0.5 text-sm font-medium leading-snug text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>

    <div className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold">Confusion matrices</h2>
        <p className="mt-1 text-sm text-ink-2">Rows are the study label. Columns are what the rule predicted. Matching cells are in bold.</p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {MODELS.map((model) => <Matrix key={model.name} model={model} />)}
      </div>
    </div>

    <Panel title="Same rule on this station">
      <p className="text-sm leading-relaxed text-ink-2">
        The Overview runs risk scoring with trend. Dissolved oxygen stays missing, so its points are never filled in as zero. Ammonia is added only from a recent TAN entry. ORP can add up to 15 provisional points below 200 mV. When an input is missing, the panel shows the score from what was measured and the level the score could reach if every missing input were at its worst.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-line text-xs text-ink-3">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Inputs available</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Accuracy</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Precision</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Recall</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-line-soft">
            <tr>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">Temperature, pH, turbidity, trends</th>
              <td className="px-3 py-2 text-right">16.6%</td>
              <td className="px-3 py-2 text-right">94.5%</td>
              <td className="py-2 pl-3 text-right">19.0%</td>
            </tr>
            <tr>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">Those, plus a TAN measurement</th>
              <td className="px-3 py-2 text-right">54.8%</td>
              <td className="px-3 py-2 text-right">93.2%</td>
              <td className="py-2 pl-3 text-right">75.8%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        Both rows use the live rule with dissolved oxygen left out, scored against the same 500 study labels. The score on the Overview is a rule total from 0 to 100. It is a level, and it is not a probability of mortality.
      </p>
    </Panel>
  </div>
);

export default DashboardPredictionPage;
