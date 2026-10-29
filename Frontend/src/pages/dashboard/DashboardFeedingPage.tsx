import React, { useCallback, useEffect, useState } from 'react';
import { useDashboardData } from '../../components/WaterQuality/useDashboardData';
import { apiClient, getApiErrorMessage } from '../../services/apiClient';
import { DeviceSelect, EmptyState, KeyValues, MetaItem, Notice, PageHead, Panel, StateMark } from '../../components/WaterQuality/Console';

interface Device { deviceId: string; name?: string; isActive: boolean }
interface FeedingCommand { id: string; action: string; status: 'PENDING' | 'ACKED'; metadata?: Record<string, unknown> | null; executedAt?: string | null; createdAt?: string }
interface FeedingState { scheduleCount: number; enabledCount: number; pendingCommands: number; lastCommand: FeedingCommand | null }
interface HardwareState { deviceId: string; online: boolean; receivedAt: string | null; state: null | { feederBusy: boolean } }

const DashboardFeedingPage: React.FC = () => {
  const { feedingSchedules, feedingLoading, triggerManual, addSchedule, toggleSchedule, removeSchedule, updateSchedule } = useDashboardData();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [feedingState, setFeedingState] = useState<FeedingState | null>(null);
  const [hardwareState, setHardwareState] = useState<HardwareState | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleLabel, setScheduleLabel] = useState('');
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const enabledCount = feedingSchedules.filter((item) => item.enabled).length;
  const deviceOnline = !!hardwareState?.online && loadedAt !== null && Date.now() - loadedAt < 20000;

  const refreshState = useCallback(async (selectedId = deviceId) => {
    if (!selectedId) return;
    try {
      const [feedingResponse, hardwareResponse] = await Promise.all([
        apiClient.get<FeedingState>(`/feeding/state?deviceId=${encodeURIComponent(selectedId)}`),
        apiClient.get<HardwareState>(`/hardware/state?deviceId=${encodeURIComponent(selectedId)}`),
      ]);
      setFeedingState(feedingResponse.data);
      setHardwareState(hardwareResponse.data);
      setLoadedAt(Date.now());
      setStateError(null);
    } catch (cause) {
      setStateError(getApiErrorMessage(cause, 'Unable to read feeder state.'));
    }
  }, [deviceId]);

  useEffect(() => {
    let active = true;
    void apiClient.get<Device[]>('/devices').then((response) => {
      if (!active) return;
      const available = (response.data || []).filter((device) => device.isActive);
      setDevices(available);
      setDeviceId((current) => current || available[0]?.deviceId || '');
    }).catch((cause) => { if (active) setStateError(getApiErrorMessage(cause, 'Unable to load registered devices.')); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    void refreshState(deviceId);
    const timer = window.setInterval(() => void refreshState(deviceId), 5000);
    return () => window.clearInterval(timer);
  }, [deviceId, refreshState]);

  const runManual = async (action: 'ON' | 'OFF' | 'TRIGGER') => {
    try {
      setManualBusy(true);
      setManualMessage(null);
      const published = await triggerManual(action, deviceId);
      setManualMessage(published
        ? `${action === 'TRIGGER' ? 'Feed trigger' : `Feeder ${action}`} published to HiveMQ. Servo movement is unconfirmed until the ESP32 acknowledges.`
        : 'Command was not sent. The broker did not accept it, and no retry was queued.');
      await refreshState();
    } catch (cause) {
      setManualMessage(getApiErrorMessage(cause, 'Unable to send the feeder command.'));
    } finally {
      setManualBusy(false);
    }
  };

  const saveSchedule = async () => {
    await addSchedule(scheduleDate, scheduleTime, scheduleLabel);
    setScheduleDate('');
    setScheduleTime('');
    setScheduleLabel('');
  };

  const feederStatus = manualBusy ? 'Sending' : hardwareState?.state?.feederBusy ? 'Feeding' : deviceOnline ? 'Ready' : 'Unavailable';
  const disabledReason = !deviceOnline ? 'Device must report online before a feeder command can be sent.' : undefined;

  return (
    <div className="space-y-5">
      <PageHead
        title="Feeding"
        description="Send feeder commands and manage feeding schedules for the ESP32 feeder."
        meta={
          <>
            <MetaItem label="Active schedules">{enabledCount} of {feedingSchedules.length}</MetaItem>
            <MetaItem label="Feeder">
              <StateMark state={manualBusy || hardwareState?.state?.feederBusy ? 'warn' : deviceOnline ? 'ok' : 'off'} className="!text-sm !font-semibold">{feederStatus}</StateMark>
            </MetaItem>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Manual control" description="Device-reported logical state. It does not confirm food was physically dispensed.">
          <div className="space-y-4">
            <DeviceSelect
              id="feeding-device"
              value={deviceId}
              devices={devices}
              onChange={(value) => { setDeviceId(value); setFeedingState(null); setHardwareState(null); setLoadedAt(null); }}
            />
            <KeyValues rows={[
              { label: 'Device', value: <StateMark state={deviceOnline ? 'ok' : 'off'}>{deviceOnline ? 'Online' : 'Offline or stale'}</StateMark> },
              { label: 'Feeder state', value: hardwareState?.state ? (hardwareState.state.feederBusy ? 'Feeding' : 'Idle') : 'Unknown' },
              { label: 'Latest command', value: feedingState?.lastCommand ? `${feedingState.lastCommand.action}: ${feedingState.lastCommand.status.toLowerCase()}${feedingState.lastCommand.metadata?.deviceResult ? ` · ${String(feedingState.lastCommand.metadata.deviceResult)}` : ''}${manualBusy ? ' · pending' : ''}` : 'None reported' },
            ]} />
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={manualBusy || !deviceOnline} title={disabledReason} onClick={() => void runManual('TRIGGER')} className="btn-primary">Feed now</button>
              <button type="button" disabled={manualBusy || !deviceOnline} title={disabledReason} onClick={() => void runManual('ON')} className="btn-secondary">Feeder on</button>
              <button type="button" disabled={manualBusy || !deviceOnline} title={disabledReason} onClick={() => void runManual('OFF')} className="btn-secondary">Feeder off</button>
            </div>
            {!deviceOnline && <Notice tone="info">Controls stay disabled until fresh, verified ESP32 telemetry arrives and the HiveMQ command connection is available.</Notice>}
            {manualMessage && <p role="status" aria-live="polite" className="text-[13px] leading-relaxed text-sounding">{manualMessage}</p>}
            {stateError && <p role="alert" className="text-[13px] text-alarm">{stateError}</p>}
            <div className="num space-y-0.5 text-xs text-ink-3">
              {feedingState?.lastCommand?.id && <p className="break-all">Command ID {feedingState.lastCommand.id}</p>}
              {loadedAt && <p>Last state poll {new Date(loadedAt).toLocaleTimeString()}</p>}
            </div>
          </div>
        </Panel>

        <Panel title="Add a schedule" description="Leave the date empty for a daily feed.">
          <form onSubmit={(event) => { event.preventDefault(); void saveSchedule(); }} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="schedule-date">Date <span className="font-normal text-ink-3">(optional)</span></label>
                <input id="schedule-date" type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor="schedule-time">Time</label>
                <input id="schedule-time" type="time" required value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className="field" />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="schedule-label">Label <span className="font-normal text-ink-3">(optional)</span></label>
              <input id="schedule-label" type="text" value={scheduleLabel} onChange={(e) => setScheduleLabel(e.target.value)} placeholder="e.g. Morning feed" className="field" />
            </div>
            <button type="submit" disabled={feedingLoading || !scheduleTime} className="btn-primary">Save schedule</button>
          </form>
        </Panel>
      </div>

      <Panel title="Scheduled feedings" description={`${enabledCount} enabled`} bodyClassName="p-0">
        {feedingLoading ? (
          <div className="space-y-2 p-5" aria-busy="true">
            {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-11 animate-pulse rounded bg-water" />)}
          </div>
        ) : feedingSchedules.length === 0 ? (
          <div className="p-5"><EmptyState title="No schedules yet">Add a time above and the feeder will run it every day, or on the date you pick.</EmptyState></div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {feedingSchedules.map((item) => (
              <li key={item.id} className="px-4 py-3 sm:px-5">
                {editingScheduleId === item.id ? (
                  <form onSubmit={(event) => { event.preventDefault(); void updateSchedule(item.id, editDate, editTime, editLabel).then(() => setEditingScheduleId(null)); }} className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <input aria-label="Date" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="field" />
                      <input aria-label="Time" type="time" required value={editTime} onChange={(e) => setEditTime(e.target.value)} className="field" />
                      <input aria-label="Label" type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="field" />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" className="btn-primary btn-sm">Save</button>
                      <button type="button" onClick={() => setEditingScheduleId(null)} className="btn-quiet btn-sm">Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex min-w-0 items-baseline gap-4">
                      <p className="num w-14 shrink-0 text-base font-semibold">{item.time}</p>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{item.label || 'Feed'}</p>
                        <p className="text-xs text-ink-3">{item.date ? item.date : 'Daily'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <StateMark state={item.enabled ? 'ok' : 'off'} className="mr-3 !text-xs">{item.enabled ? 'Enabled' : 'Disabled'}</StateMark>
                      <button type="button" onClick={() => void toggleSchedule(item)} className="btn-quiet btn-sm">{item.enabled ? 'Disable' : 'Enable'}</button>
                      <button type="button" onClick={() => { setEditingScheduleId(item.id); setEditDate(item.date || ''); setEditTime(item.time); setEditLabel(item.label || ''); }} className="btn-quiet btn-sm">Edit</button>
                      <button type="button" onClick={() => void removeSchedule(item.id)} className="btn-quiet btn-sm !text-alarm hover:!bg-alarm-bg">Remove</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
};

export default DashboardFeedingPage;
