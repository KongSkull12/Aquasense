import { SensorHealthPanel } from '../../components/WaterQuality/SensorHealthPanel';
import React from 'react';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import type { WaterQualityStats } from '../../types/water';
import { currentWaterSensorValue, isReadingLive, LIVE_READING_MS } from '../../components/WaterQuality/sensorDisplay';
import { RiskAssessmentPanel } from '../../components/WaterQuality/RiskAssessmentPanel';
import { BandChart, BandKey, ConnectionNotice, EmptyState, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';
import { bandLabel, classifyBand, formatNormalBand, type BandKey as LimitKey } from '../../components/WaterQuality/thresholdBands';

type ParameterKey = 'temperature' | 'ph' | 'orp' | 'turbidity' | 'ammonia';

type CardStats = { current: number|null; average: number|null; min: number|null; max: number|null };

type CardConfig = {
  key: 'temperature' | 'ph' | 'orp' | 'turbidity';
  label: string;
  unit: string;
  digits: number;
  domain: [number | 'auto', number | 'auto'];
};

const parameterCards: CardConfig[] = [
  { key: 'temperature', label: 'Temperature', unit: '°C', digits: 1, domain: [20, 36] },
  { key: 'ph', label: 'pH', unit: '', digits: 2, domain: [4, 10] },
  { key: 'orp', label: 'ORP / redox', unit: 'mV', digits: 1, domain: ['auto', 'auto'] },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU', digits: 1, domain: ['auto', 'auto'] },
];

const formatValue = (value: number|null, unit: string, digits: number) => value === null ? '—' : `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;

const DashboardParametersPage: React.FC = () => {
  const { statistics, chartData, riskAssessment, thresholdBands, latestReading, error, isConnected } = useDashboardData();
  // Readings, statistics and trends are shown only while the device is sending.
  const live = isReadingLive(latestReading);
  const liveTurbidityNtu = latestReading?.turbidityUnit === 'NTU' ? latestReading.turbidity : null;

  const fractionAvailable = latestReading?.speciation?.status === 'AVAILABLE';
  const fraction = fractionAvailable ? latestReading.speciation?.percent ?? null : null;
  const fractionChart = chartData.filter((point) => point.nh3FractionPercent !== null && point.nh3FractionPercent !== undefined);

  return (
    <div className="space-y-5">
      <PageHead
        title="Parameters"
        description={<>Sensor evidence from the latest monitoring window: current value, window statistics, and sensor health.{statistics?.stale ? ' Live statistics are stale while disconnected.' : ''}</>}
        actions={<BandKey />}
      />

      <ConnectionNotice isConnected={isConnected} error={error} />

      <SensorHealthPanel reading={latestReading} />

      {!live ? (
        <EmptyState title={latestReading ? 'No live data from the device' : 'No sensor data yet'}>
          {latestReading
            ? `The ESP32 has not sent a reading in the last ${LIVE_READING_MS / 1000} seconds, so no values, statistics or trends are shown. Check its power, Wi-Fi and MQTT connection.`
            : 'Values, statistics and trends appear here once your registered ESP32 starts sending readings.'}
        </EmptyState>
      ) : statistics ? (
        <section aria-label="Parameter trends" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {parameterCards.map((item) => {
            const sensorStats: WaterQualityStats[ParameterKey] = statistics[item.key];
            const sensorValue = currentWaterSensorValue(latestReading, item.key);
            const stats: CardStats = { ...sensorStats, current: item.key === 'turbidity'
              ? liveTurbidityNtu ?? null
              : sensorValue };
            const health = latestReading?.sensorHealth?.[item.key];
            const bandKey = item.key === 'orp' ? null : item.key as LimitKey;
            const level = bandKey && stats.current != null ? classifyBand(stats.current, thresholdBands[bandKey]) : null;
            const levelLabel = level ? bandLabel(level) : null;
            const guidance = item.key === 'orp'
              ? 'Redox, after a saved calibration'
              : `Normal ${formatNormalBand(thresholdBands[item.key as LimitKey], item.digits, item.unit)}`;
            const chartBand: [number, number] | undefined = item.key === 'temperature' || item.key === 'ph'
              ? [thresholdBands[item.key].normalMin ?? 0, thresholdBands[item.key].normalMax ?? 0]
              : item.key === 'turbidity' && thresholdBands.turbidity.normalMax != null
                ? [0, thresholdBands.turbidity.normalMax]
                : undefined;
            const sensorStatus = statistics.stale ? 'STALE' : !latestReading ? 'UNAVAILABLE' : !health ? 'UNKNOWN' :
              !health.valid || health.measurementValid===false ? (health.health==='STALE' ? 'STALE' : 'UNAVAILABLE') :
              health.health==='UNSTABLE' || health.stability==='UNSTABLE' ? 'UNSTABLE' :
              health.calibration!=='CALIBRATED' ? 'CALIBRATION REQUIRED' :
              health.stability!=='STABLE' ? 'SETTLING' : item.key === 'orp' ? 'Calibrated reading' : levelLabel || 'Unclassified';
            const statusLabel = sensorStatus;
            const statusState: MarkState = ['STALE', 'UNSTABLE'].includes(statusLabel) ? 'warn'
              : statusLabel === 'CALIBRATION REQUIRED' ? 'trust'
              : statusLabel === 'SETTLING' ? 'info'
                : ['UNAVAILABLE', 'UNKNOWN', 'Unclassified'].includes(statusLabel) ? 'off'
                  : statusLabel === 'Alert' ? 'alarm'
                    : statusLabel === 'Warning' ? 'warn'
                      : 'ok';
            const statusText = /^[A-Z ]+$/.test(statusLabel) ? statusLabel.charAt(0) + statusLabel.slice(1).toLowerCase() : statusLabel;
            const chart = chartData.filter(point=>item.key!=='turbidity' || (point.turbidityUnit==='NTU' && point.turbidity != null)).slice(-20);
            const currentLabel = item.key==='orp' && stats.current!==null && health?.valid!==true
              ? `${formatValue(stats.current, item.unit, item.digits)}`
              : formatValue(stats.current, item.unit, item.digits);

            return (
              <Panel
                key={item.key}
                title={item.label}
                description={guidance}
                actions={<span className="num text-xl font-semibold">{currentLabel}</span>}
                bodyClassName="px-4 pb-4 pt-3 sm:px-5"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <StateMark state={statusState}>{item.key === 'orp' && stats.current !== null && health?.valid !== true ? `Unverified · ${statusText}` : statusText}</StateMark>
                  <p className="num text-xs text-ink-3">
                    Avg {formatValue(stats.average, item.unit, item.digits)} · Min {formatValue(stats.min, item.unit, item.digits)} · Max {formatValue(stats.max, item.unit, item.digits)}
                  </p>
                </div>
                <BandChart label={item.label} data={chart} dataKey={item.key} domain={item.domain} band={chartBand} unit={item.unit} digits={item.digits} height={170} />
              </Panel>
            );
          })}

          <Panel
            title="Unionized NH₃ fraction"
            description="Freshwater fraction of TAN; concentration still needs measured TAN"
            actions={<span className="num text-xl font-semibold">{fraction === null ? '—' : `${fraction.toFixed(2)}%`}</span>}
            bodyClassName="px-4 pb-4 pt-3 sm:px-5"
          >
            <div className="mb-3">
              {fractionAvailable
                ? <StateMark state="info">Calculated from pH and temperature</StateMark>
                : <StateMark state="off">{latestReading?.speciation?.reason || 'Fresh qualified pH and temperature readings are required.'}</StateMark>}
            </div>
            <BandChart label="NH₃ fraction" data={fractionChart} dataKey="nh3FractionPercent" domain={['auto', 'auto']} unit="%" digits={3} height={170} emptyText="Not calculated yet" />
          </Panel>

          <RiskAssessmentPanel assessment={riskAssessment} compact />
        </section>
      ) : !isConnected ? (
        <EmptyState title="No window statistics yet">Trends and averages arrive over the live connection and appear here once it reconnects.</EmptyState>
      ) : (
        <section aria-label="Loading parameters" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="panel h-[262px] animate-pulse p-5">
              <div className="h-4 w-32 rounded bg-line-soft" />
              <div className="mt-3 h-3 w-48 rounded bg-line-soft" />
              <div className="mt-6 h-[150px] rounded bg-water" />
            </div>
          ))}
        </section>
      )}
    </div>
  );
};

export default DashboardParametersPage;
