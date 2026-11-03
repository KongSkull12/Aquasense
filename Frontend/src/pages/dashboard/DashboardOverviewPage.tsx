import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import { getDashboardProfile } from '../../components/WaterQuality/dashboardProfile';
import { isReadingLive, LIVE_READING_MS } from '../../components/WaterQuality/sensorDisplay';
import { BandChart, BandKey, ChartPanel, KeyValues, MetaItem, Notice, PageHead, Panel, StateMark, type MarkState } from '../../components/WaterQuality/Console';
import { bandLabel, classifyBand, formatNormalBand, type BandKey as LimitKey } from '../../components/WaterQuality/thresholdBands';
import { RiskAssessmentPanel } from '../../components/WaterQuality/RiskAssessmentPanel';
import { isStaffRole } from '../../auth/session';

type Status = { label: string; state: MarkState };
type NextStep = { text: string; to?: string; cta?: string };

const hasSeries = (data: object[], key: string) => data.some((point) => {
  const value = (point as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value);
});

// Next upcoming enabled schedule: dated entries on their day, undated ones daily.
const nextFeed = (schedules: Array<{ date: string | null; time: string; enabled: boolean; label: string | null }>, now = new Date()) => {
  const candidates = schedules.filter((item) => item.enabled && /^\d{1,2}:\d{2}/.test(item.time)).map((item) => {
    const [hours, minutes] = item.time.split(':').map(Number);
    const at = item.date ? new Date(`${item.date}T00:00:00`) : new Date(now);
    at.setHours(hours, minutes, 0, 0);
    if (!item.date && at <= now) at.setDate(at.getDate() + 1);
    return { item, at };
  }).filter(({ at }) => Number.isFinite(at.getTime()) && at > now);
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  return candidates[0] ?? null;
};

const DashboardOverviewPage: React.FC = () => {
  const { isConnected, latestReading, chartData, riskAssessment, thresholdBands, error, activeAlerts, feedingSchedules } = useDashboardData();
  const [profile, setProfile] = useState(getDashboardProfile());
  const staffSession = isStaffRole();

  useEffect(() => {
    const refreshProfile = () => setProfile(getDashboardProfile());
    window.addEventListener('farmerProfileUpdated', refreshProfile);
    return () => window.removeEventListener('farmerProfileUpdated', refreshProfile);
  }, []);

  const orpIsStale = latestReading?.sensorHealth?.orp.health === 'STALE';
  const orpIsCalibrated = latestReading?.sensorHealth?.orp.valid === true
    && latestReading.sensorHealth.orp.health === 'VALID'
    && latestReading.sensorHealth.orp.calibration === 'CALIBRATED'
    && latestReading.sensorHealth.orp.stability === 'STABLE';
  const monitoredSensors = ['temperature', 'ph', 'turbidity', 'orp'] as const;
  const validSensorCount = monitoredSensors.filter((name) => latestReading?.sensorHealth?.[name].valid && latestReading.sensorHealth[name].health === 'VALID').length;
  const calibratedSensorCount = monitoredSensors.filter((name) => latestReading?.sensorHealth?.[name].calibration === 'CALIBRATED' && latestReading.sensorHealth[name].stability === 'STABLE').length;
  // Only data from a device that is currently sending is shown; no history fallbacks.
  const live = isReadingLive(latestReading);
  const liveChart = live ? chartData : [];
  const turbidityNtuHistoryAvailable = liveChart.some((point) => point.turbidityUnit === 'NTU' && point.turbidity !== null && point.turbidity !== undefined);
  const latestTankLevelPoint = [...liveChart].reverse().find((point) => point.tankLevelPercent != null && Number.isFinite(point.tankLevelPercent));
  const latestTankLevel = latestReading?.tankLevel ?? latestReading?.sensorHealth?.ultrasonic ?? null;
  const noValue = live ? 'No reading' : 'No live data';
  const reportedPh = latestReading?.ph ?? latestReading?.sensorHealth?.ph.value ?? null;
  const currentTurbidityNtu = latestReading?.turbidityUnit === 'NTU'
    ? latestReading.turbidity ?? latestReading.sensorHealth?.turbidity.value ?? null
    : null;
  const turbidityNtu = currentTurbidityNtu;
  const speciationAvailable = latestReading?.speciation?.status === 'AVAILABLE' && latestReading.speciation.percent != null;

  const isQualified = (name: 'temperature' | 'ph' | 'turbidity') => {
    const s = latestReading?.sensorHealth?.[name];
    return s?.valid === true && s.health === 'VALID' && s.calibration === 'CALIBRATED' && s.stability === 'STABLE';
  };
  const humanize = (value: string) => value.toLowerCase().replace(/_/g, ' ');

  const bandFor = (param: 'temp' | 'ph' | 'turbidity'): LimitKey => param === 'temp' ? 'temperature' : param;
  const getStatus = (param: 'temp' | 'ph' | 'turbidity', value: number | null | undefined, qualified: boolean, calibrated: boolean): Status => {
    if (value == null || !Number.isFinite(value)) return { label: noValue, state: 'off' };
    if (!calibrated) return { label: 'Calibration required, not classified', state: 'trust' };
    if (!qualified) return { label: 'Calibrated, settling', state: 'info' };
    const label = bandLabel(classifyBand(value, thresholdBands[bandFor(param)]));
    return { label, state: label === 'Normal' ? 'ok' : label === 'Warning' ? 'warn' : 'alarm' };
  };

  const isCalibrated = (name: 'temperature' | 'ph' | 'turbidity' | 'orp') => latestReading?.sensorHealth?.[name]?.calibration === 'CALIBRATED';
  const turbidityStatus: Status = currentTurbidityNtu != null
    ? latestReading?.sensorHealth?.turbidity.valid === false
      ? { label: `Reported, ${humanize(latestReading.sensorHealth.turbidity.health)}`, state: 'warn' }
      : getStatus('turbidity', currentTurbidityNtu, isQualified('turbidity'), isCalibrated('turbidity'))
    : getStatus('turbidity', null, false, false);

  const readings: Array<{ label: string; value: string | null; unit?: string; status: Status }> = [
    {
      label: 'Temperature',
      value: latestReading?.temperature != null ? latestReading.temperature.toFixed(1) : null,
      unit: '°C',
      status: getStatus('temp', latestReading?.temperature, isQualified('temperature'), isCalibrated('temperature')),
    },
    {
      label: 'pH',
      value: reportedPh != null ? reportedPh.toFixed(2) : null,
      status: latestReading?.sensorHealth?.ph.valid === false && reportedPh != null
        ? { label: `Reported, ${humanize(latestReading.sensorHealth.ph.health)}`, state: 'warn' }
        : getStatus('ph', reportedPh, isQualified('ph'), isCalibrated('ph')),
    },
    {
      label: 'ORP / redox',
      value: latestReading?.orp != null ? latestReading.orp.toFixed(1) : null,
      unit: 'mV',
      status: !live ? { label: noValue, state: 'off' }
        : orpIsStale ? { label: 'Stale sample', state: 'warn' }
        : orpIsCalibrated ? { label: 'Calibrated reading', state: 'ok' }
          : isCalibrated('orp') ? { label: 'Calibrated, settling', state: 'info' }
          : latestReading?.orp != null ? { label: 'Reported; calibration required', state: 'trust' }
            : { label: noValue, state: 'off' },
    },
    {
      label: 'Turbidity',
      value: turbidityNtu != null ? turbidityNtu.toFixed(1) : null,
      unit: 'NTU',
      status: turbidityStatus,
    },
    {
      label: 'Tank level',
      value: live && latestTankLevel?.levelPercent != null ? latestTankLevel.levelPercent.toFixed(1) : null,
      unit: '%',
      status: !live ? { label: noValue, state: 'off' }
        : latestTankLevel?.valid && latestTankLevel.distanceCm != null ? { label: `${latestTankLevel.distanceCm.toFixed(1)} cm below sensor`, state: 'info' }
          : latestTankLevel?.levelPercent != null ? { label: `Reported: ${latestTankLevel.reason}`, state: 'warn' }
            : { label: latestTankLevel?.reason || 'Ultrasonic reading unavailable', state: 'off' },
    },
    {
      label: 'NH₃ fraction of TAN',
      value: live && speciationAvailable ? latestReading!.speciation!.percent!.toFixed(2) : null,
      unit: '%',
      status: !live ? { label: noValue, state: 'off' }
        : speciationAvailable
          ? { label: 'Calculated from pH and temperature', state: 'info' }
          : { label: latestReading?.speciation?.reason || 'Needs calibrated pH and temperature', state: 'off' },
    },
  ];

  // One plain sentence on what to do next, derived only from reported state.
  const nextSteps: NextStep[] = [];
  if (!isConnected) nextSteps.push({ text: 'Live connection lost. Check that the AquaSense server is running.' });
  if (!latestReading) nextSteps.push({ text: 'Waiting for the first sensor reading. Make sure your device is registered.', ...(staffSession ? {} : { to: '/dashboard/settings', cta: 'Open settings' }) });
  else if (!live) nextSteps.push({ text: `No data from the ESP32 in the last ${LIVE_READING_MS / 1000} seconds, so no readings are shown. Check the device's power, Wi-Fi and MQTT connection.` });
  if (activeAlerts.length) nextSteps.splice(isConnected && live ? 0 : nextSteps.length, 0, { text: `${activeAlerts.length} active alert${activeAlerts.length > 1 ? 's' : ''} need${activeAlerts.length > 1 ? '' : 's'} review.`, to: '/dashboard/alerts', cta: 'Review alerts' });
  if (live && latestReading) {
    const named = (label: 'Alert' | 'Warning') => readings.filter((reading) => reading.status.label === label).map((reading) => reading.label);
    const alertNames = named('Alert');
    const warningNames = named('Warning');
    if (alertNames.length) nextSteps.unshift({ text: `${alertNames.join(' and ')} ${alertNames.length > 1 ? 'are' : 'is'} in Alert. Check the tank.`, ...(staffSession ? {} : { to: '/dashboard/thresholds', cta: 'Thresholds' }) });
    else if (warningNames.length) nextSteps.unshift({ text: `${warningNames.join(' and ')} ${warningNames.length > 1 ? 'are' : 'is'} in Warning.`, ...(staffSession ? {} : { to: '/dashboard/thresholds', cta: 'Thresholds' }) });
    const uncalibrated = (['temperature', 'ph'] as const).filter((name) => latestReading.sensorHealth?.[name] && !isCalibrated(name));
    if (uncalibrated.length) nextSteps.push({ text: `Calibrate the ${uncalibrated.map((name) => name === 'ph' ? 'pH' : 'temperature').join(' and ')} probe${uncalibrated.length > 1 ? 's' : ''} so readings can be classified and the NH₃ fraction estimated.`, ...(staffSession ? {} : { to: '/dashboard/calibration', cta: 'Calibrate' }) });
    const silent = [latestReading.orp == null ? 'ORP' : null, readings[4].value == null ? 'tank level' : null].filter(Boolean);
    if (silent.length) nextSteps.push({ text: `${silent.join(' and ')} ${silent.length > 1 ? 'sensors are' : 'sensor is'} not reporting.` });
    if (riskAssessment?.status === 'AVAILABLE' && (riskAssessment.level === 'High' || riskAssessment.level === 'Extreme')) {
      nextSteps.unshift({ text: `Mortality risk score is ${riskAssessment.level} (${riskAssessment.score}/100). Check the contributing factors below and the tank.` });
    }
    if (!nextSteps.length) nextSteps.push({ text: 'All reporting sensors are calibrated and Normal.' });
  }
  const nextTone = !isConnected || (latestReading && !live) ? 'alarm' : nextSteps[0]?.text.includes('in Alert') ? 'alarm' : nextSteps[0]?.text.includes('in Warning') || activeAlerts.length ? 'warn' : 'info';
  const upcomingFeed = nextFeed(feedingSchedules);
  const enabledFeeds = feedingSchedules.filter((item) => item.enabled).length;

  const lastReadingTime = latestReading?.timestamp ? new Date(latestReading.timestamp) : null;

  return (
    <div className="space-y-5">
      <PageHead
        title={profile.tankName || 'Main tank'}
        description="Live water readings. Values refresh about every 5 seconds; each shows whether the sensor behind it can be trusted."
        meta={
          <>
            <MetaItem label="Last reading">
              {lastReadingTime && Number.isFinite(lastReadingTime.getTime()) ? lastReadingTime.toLocaleTimeString('en-US') : 'None yet'}
            </MetaItem>
            <MetaItem label="Dashboard connection">
              <StateMark state={isConnected ? 'ok' : 'alarm'} className="!text-sm !font-semibold">{isConnected ? 'Online' : 'Offline'}</StateMark>
            </MetaItem>
          </>
        }
      />

      {/* When disconnected, the Next line already says so. */}
      {error && isConnected && <Notice tone="warn" title="Data connection">{error}</Notice>}

      {/* Next action */}
      <div className={`flex gap-3 rounded-md px-4 py-3 text-sm leading-relaxed ${
        nextTone === 'alarm' ? 'bg-alarm-bg text-[#7a1a12]' : nextTone === 'warn' ? 'bg-warn-bg text-[#6b3504]' : 'bg-band text-ink'
      }`} role="status" aria-live="polite">
        <span className="shrink-0 font-semibold">Next</span>
        <ul className="space-y-1">
          {nextSteps.map((step) => (
            <li key={step.text}>
              {step.text}
              {step.to && <> <Link to={step.to} className="whitespace-nowrap font-semibold underline decoration-current/30 underline-offset-[3px] hover:decoration-current">{step.cta}</Link></>}
            </li>
          ))}
        </ul>
      </div>

      {/* Reading strip: fixed furniture per sensor, reflows in whole cells */}
      <section aria-label="Current readings" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
        {readings.map((reading) => (
          <div key={reading.label} className="flex min-w-0 flex-col bg-white px-4 py-3.5 sm:px-5 sm:py-4">
            <p className="text-[13px] font-medium text-ink-2">{reading.label}</p>
            <p key={reading.value ?? 'none'} className={`num reading-settle mt-1.5 text-[28px] font-semibold leading-none tracking-tight sm:text-[32px] ${reading.value == null ? 'text-ink-3' : 'text-ink'}`}>
              {reading.value ?? '—'}
              {reading.value != null && reading.unit && <span className="ml-1 text-base font-medium text-ink-3">{reading.unit}</span>}
            </p>
            <StateMark state={reading.status.state} className="mt-2.5 !text-xs">{reading.status.label}</StateMark>
          </div>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Trends" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Recent trends</h2>
            <BandKey />
          </div>
          {(() => {
            const turbidityData = liveChart.filter((point) => point.turbidityUnit === 'NTU' && point.turbidity != null);
            const series = [
              { key: 'temperature', title: 'Temperature (°C)', label: 'Temperature', guidance: `Normal ${formatNormalBand(thresholdBands.temperature, 1, '°C')}`, data: liveChart, domain: [20, 36] as [number, number], band: [thresholdBands.temperature.normalMin ?? 26, thresholdBands.temperature.normalMax ?? 29] as [number, number], unit: '°C', digits: 1, empty: 'No temperature samples yet' },
              { key: 'ph', title: 'pH', label: 'pH', guidance: `Normal ${formatNormalBand(thresholdBands.ph, 2, '')}`, data: liveChart, domain: [4, 10] as [number, number], band: [thresholdBands.ph.normalMin ?? 7, thresholdBands.ph.normalMax ?? 8.5] as [number, number], unit: '', digits: 2, empty: 'No pH samples yet' },
              { key: 'orp', title: 'ORP / redox (mV)', label: 'ORP', guidance: 'No validated range', data: liveChart, domain: ['auto', 'auto'] as ['auto', 'auto'], unit: 'mV', digits: 1, empty: 'No ORP samples reported',
                note: orpIsStale ? 'Latest sample is stale.' : isCalibrated('orp') ? 'Saved device calibration. ORP is a redox reading, not dissolved oxygen.' : latestReading?.orp != null ? 'Device-reported trend. Capture an ORP standard before it can be interpreted.' : undefined },
              { key: 'turbidity', title: 'Turbidity (NTU)', label: 'Turbidity', guidance: `Normal ${formatNormalBand(thresholdBands.turbidity, 1, 'NTU')}`, data: turbidityData, domain: ['auto', 'auto'] as ['auto', 'auto'], band: thresholdBands.turbidity.normalMax == null ? undefined : [0, thresholdBands.turbidity.normalMax] as [number, number], unit: 'NTU', digits: 1, empty: 'NTU unavailable for current samples',
                note: turbidityNtuHistoryAvailable ? (isCalibrated('turbidity') ? 'Linear estimate from the saved calibration.' : 'Linear estimate; sensor calibration required.') : undefined },
              { key: 'nh3FractionPercent', title: 'NH₃ fraction (%)', label: 'NH₃ fraction', guidance: 'From qualified pH + temperature', data: liveChart, domain: ['auto', 'auto'] as ['auto', 'auto'], unit: '%', digits: 3,
                empty: `Not calculated: ${(latestReading?.speciation?.reason || 'needs calibrated pH and temperature').replace(/^\w/, (c) => c.toLowerCase()).replace(/[.\s]*$/, '')}`,
                note: `${speciationAvailable ? `Latest fraction ${latestReading!.speciation!.percent!.toFixed(3)}%. ` : ''}TAN and NH₃-N concentration need a measured TAN value.` },
              { key: 'tankLevelPercent', title: 'Tank level (%)', label: 'Tank level', guidance: 'Ultrasonic, as reported', data: liveChart, domain: [0, 100] as [number, number], unit: '%', digits: 1, empty: 'No level samples reported',
                note: latestTankLevelPoint ? `Last history sample ${latestTankLevelPoint.time}.` : undefined },
            ];
            const withData = series.filter((item) => hasSeries(item.data, item.key));
            const withoutData = series.filter((item) => !hasSeries(item.data, item.key));
            return (
              <>
                {withData.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {withData.map((item, index) => (
                      <ChartPanel key={item.key} title={item.title} guidance={item.guidance} note={item.note} className={withData.length % 2 === 1 && index === withData.length - 1 ? 'md:col-span-2' : ''}>
                        <BandChart label={item.label} data={item.data} dataKey={item.key} domain={item.domain} band={'band' in item ? item.band : undefined} unit={item.unit} digits={item.digits} />
                      </ChartPanel>
                    ))}
                  </div>
                )}
                {withoutData.length > 0 && (
                  <div className={`panel ${withData.length ? 'mt-4' : ''}`}>
                    <p className="border-b border-line-soft px-4 py-2.5 text-[13px] font-semibold text-ink-2 sm:px-5">No trend yet</p>
                    <ul className="divide-y divide-line-soft">
                      {withoutData.map((item) => (
                        <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-[13px] sm:px-5">
                          <span className="font-medium text-ink">{item.label}</span>
                          <span className="text-ink-3">{live ? item.empty : 'No live data'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            );
          })()}
        </section>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Feeding and risk assessment">
          <Panel title="Feeding" actions={<Link to="/dashboard/feeding" className="link text-[13px]">Open feeding</Link>}>
            {upcomingFeed ? (
              <div className="mb-4">
                <p className="text-xs text-ink-3">Next feed</p>
                <p className="num mt-0.5 text-[22px] font-semibold leading-tight">
                  {upcomingFeed.item.time}
                  <span className="ml-2 text-sm font-medium text-ink-2">
                    {upcomingFeed.at.toDateString() === new Date().toDateString() ? 'today' : upcomingFeed.at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                </p>
                {upcomingFeed.item.label && <p className="text-[13px] text-ink-2">{upcomingFeed.item.label}</p>}
              </div>
            ) : (
              <p className="mb-4 text-[13px] leading-relaxed text-ink-2">No upcoming feed is scheduled.</p>
            )}
            <KeyValues rows={[{ label: 'Enabled schedules', value: `${enabledFeeds} of ${feedingSchedules.length}` }]} />
          </Panel>
          <RiskAssessmentPanel assessment={live ? riskAssessment : null} />

          <Panel title="Sensor status">
            <KeyValues rows={[
              { label: 'Sensors valid', value: `${validSensorCount} of ${monitoredSensors.length}` },
              { label: 'Calibrated and stable', value: `${calibratedSensorCount} of ${monitoredSensors.length}` },
            ]} />
          </Panel>

          <Panel title="What this dashboard cannot tell you">
            <ul className="space-y-2.5 text-[13px] leading-relaxed text-ink-2">
              <li>The mortality-risk score is a rule-based model for <i>Cherax quadricarinatus</i>. It has not been validated against field mortality and is not a probability or a time-to-critical estimate.</li>
              <li>pH and temperature give the NH₃ fraction only. They cannot determine TAN concentration.</li>
              <li>Temperature and pH marks follow the Thresholds tab. Turbidity uses the alert-rule cuts there, not a species limit. ORP has no husbandry band.</li>
              <li>“Online” means this browser is connected. Check the last reading time to confirm sensors are reporting.</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
};

export default DashboardOverviewPage;
