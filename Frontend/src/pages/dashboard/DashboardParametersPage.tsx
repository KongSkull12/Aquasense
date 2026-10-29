import { SensorHealthPanel } from '../../components/WaterQuality/SensorHealthPanel';
import React from 'react';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import type { WaterQualityStats } from '../../types/water';
import { currentWaterSensorValue, isReadingLive, LIVE_READING_MS } from '../../components/WaterQuality/sensorDisplay';
import { BandChart, BandKey, ConnectionNotice, EmptyState, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';

type ParameterKey = 'temperature' | 'ph' | 'orp' | 'turbidity' | 'ammonia';

type CardStats = { current: number|null; average: number|null; min: number|null; max: number|null };

type CardConfig = {
  key: 'temperature' | 'ph' | 'orp' | 'turbidity';
  label: string;
  guidance: string;
  unit: string;
  digits: number;
  domain: [number | 'auto', number | 'auto'];
  band?: [number, number];
  normal: (value: number) => boolean;
  normalLabel: string;
  warnLabel: string;
};

const parameterCards: CardConfig[] = [
  { key: 'temperature', label: 'Temperature', guidance: 'Growth guidance 26–29 °C', unit: '°C', digits: 1, domain: [20, 36], band: [26, 29], normal: (value) => value >= 26 && value <= 29, normalLabel: 'Within guidance', warnLabel: 'Outside guidance' },
  { key: 'ph', label: 'pH', guidance: 'Culture guidance 7.0–8.5', unit: '', digits: 2, domain: [4, 10], band: [7, 8.5], normal: (value) => value >= 7 && value <= 8.5, normalLabel: 'Within guidance', warnLabel: 'Outside guidance' },
  { key: 'orp', label: 'ORP / redox', guidance: 'Reported; uncalibrated', unit: 'mV', digits: 1, domain: ['auto', 'auto'], normal: () => false, normalLabel: 'Not classified', warnLabel: 'Not classified' },
  { key: 'turbidity', label: 'Turbidity', guidance: 'No validated NTU limit', unit: 'NTU', digits: 1, domain: ['auto', 'auto'], normal: () => false, normalLabel: 'Unclassified', warnLabel: 'Unclassified' },
];

const formatValue = (value: number|null, unit: string, digits: number) => value === null ? '—' : `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;

const DashboardParametersPage: React.FC = () => {
  const { statistics, chartData, predictiveWarning, latestReading, error, isConnected } = useDashboardData();
  // Readings, statistics and trends are shown only while the device is sending.
  const live = isReadingLive(latestReading);
  const liveTurbidityNtu = latestReading?.turbidityUnit === 'NTU' ? latestReading.turbidity : null;

  const riskModelValidated = predictiveWarning?.modelStatus === 'READY'
    && predictiveWarning.validationStatus === 'VALIDATED'
    && predictiveWarning.analysisStatus === 'AVAILABLE'
    && Number.isFinite(predictiveWarning.riskScore);
  const currentRiskScore = riskModelValidated ? predictiveWarning?.riskScore ?? null : null;
  const currentRiskLevel = riskModelValidated ? predictiveWarning?.warningCard?.riskLevel ?? 'UNAVAILABLE' : 'UNAVAILABLE';

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
            const isNormal = stats.current!==null && item.normal(stats.current);
            const sensorStatus = statistics.stale ? 'STALE' : !latestReading ? 'UNAVAILABLE' : !health ? 'UNKNOWN' :
              !health.valid || health.measurementValid===false ? (health.health==='STALE' ? 'STALE' : 'UNAVAILABLE') :
              health.health==='UNSTABLE' || health.stability==='UNSTABLE' ? 'UNSTABLE' :
              health.calibration!=='CALIBRATED' ? 'CALIBRATION REQUIRED' : isNormal ? item.normalLabel : item.warnLabel;
            const statusLabel = item.key==='turbidity' && sensorStatus===item.normalLabel ? 'Unclassified: no species NTU limit' : sensorStatus;
            const statusState: MarkState = ['STALE', 'UNSTABLE'].includes(statusLabel) || statusLabel.startsWith('Last NTU') ? 'warn'
              : statusLabel === 'CALIBRATION REQUIRED' ? 'trust'
                : ['UNAVAILABLE', 'UNKNOWN'].includes(statusLabel) || statusLabel.startsWith('Unclassified') || statusLabel === 'Not classified' ? 'off'
                  : isNormal ? 'ok' : 'warn';
            const statusText = /^[A-Z ]+$/.test(statusLabel) ? statusLabel.charAt(0) + statusLabel.slice(1).toLowerCase() : statusLabel;
            const chart = chartData.filter(point=>item.key!=='turbidity' || (point.turbidityUnit==='NTU' && point.turbidity != null)).slice(-20);
            const currentLabel = item.key==='orp' && stats.current!==null && health?.valid!==true
              ? `${formatValue(stats.current, item.unit, item.digits)}`
              : formatValue(stats.current, item.unit, item.digits);

            return (
              <Panel
                key={item.key}
                title={item.label}
                description={item.guidance}
                actions={<span className="num text-xl font-semibold">{currentLabel}</span>}
                bodyClassName="px-4 pb-4 pt-3 sm:px-5"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <StateMark state={statusState}>{item.key === 'orp' && stats.current !== null && health?.valid !== true ? `Unverified · ${statusText}` : statusText}</StateMark>
                  <p className="num text-xs text-ink-3">
                    Avg {formatValue(stats.average, item.unit, item.digits)} · Min {formatValue(stats.min, item.unit, item.digits)} · Max {formatValue(stats.max, item.unit, item.digits)}
                  </p>
                </div>
                <BandChart label={item.label} data={chart} dataKey={item.key} domain={item.domain} band={item.band} unit={item.unit} digits={item.digits} height={170} />
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

          <Panel title="Risk model" bodyClassName="px-4 pb-4 pt-3 sm:px-5">
            <StateMark state={currentRiskLevel === 'UNAVAILABLE' ? 'off' : currentRiskLevel === 'LOW' ? 'ok' : currentRiskLevel === 'MODERATE' ? 'warn' : 'alarm'} className="!text-base !font-semibold">
              {currentRiskLevel === 'UNAVAILABLE' ? 'Unavailable' : currentRiskLevel}
            </StateMark>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              {currentRiskScore === null
                ? 'No validated, commissioned risk model is available, so no score is shown.'
                : `Validated model index: ${currentRiskScore.toFixed(2)} / 100.`}
            </p>
          </Panel>
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
