import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useWaterQualityWebSocket } from '../../hooks/useWaterQualityWebSocket';
import { apiClient } from '../../services/apiClient';
import type { PredictiveAnalyticsResult, PredictionLog } from '../../types/water';
import type { SmsLogEntry } from '../../types/sms';

interface ChartDataPoint {
  time: string;
  temperature?: number|null;
  ph?: number|null;
  do?: number|null;
  turbidity?: number|null;
}

interface FeedingSchedule {
  id: string;
  date: string | null;
  time: string;
  enabled: boolean;
  label: string | null;
}

export const WaterQualityDashboard: React.FC = () => {
  const { isConnected, latestReading, historyReadings, statistics, alerts, error: wsError, requestStatistics, requestLatestReading, requestHistory } =
    useWaterQualityWebSocket();
  const navigate = useNavigate();

  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [feedingSchedules, setFeedingSchedules] = useState<FeedingSchedule[]>([]);
  const [feedingLoading, setFeedingLoading] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleLabel, setScheduleLabel] = useState('');
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [predictiveWarning, setPredictiveWarning] = useState<PredictiveAnalyticsResult | null>(null);
  const [smsLogs, setSmsLogs] = useState<SmsLogEntry[]>([]);
  const [activeSection, setActiveSection] = useState('overview');

  const goToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const node = document.getElementById(sectionId);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if (isConnected) {
      requestStatistics(60);
      requestLatestReading();
      requestHistory(60);
    }
  }, [isConnected, requestStatistics, requestLatestReading, requestHistory]);

  useEffect(() => {
    if (!historyReadings.length) {
      return;
    }

    const sorted = [...historyReadings]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-30)
      .map((reading) => ({
        time: new Date(reading.timestamp).toLocaleTimeString(),
        temperature: reading.temperature,
        ph: reading.ph,
        do: reading.do,
        turbidity: reading.turbidity,
      }));

    setChartData(sorted);
  }, [historyReadings]);

  useEffect(() => {
    if (latestReading) {
      const time = new Date(latestReading.timestamp).toLocaleTimeString();
      setChartData((prev) => {
        const deduped = prev.filter((point) => point.time !== time);
        return [
          ...deduped.slice(-29),
          {
            time,
            temperature: latestReading.temperature,
            ph: latestReading.ph,
            do: latestReading.do,
            turbidity: latestReading.turbidity,
          },
        ];
      });
    }
  }, [latestReading]);

  const loadFeedingSchedules = async () => {
    try {
      setFeedingLoading(true);
      const response = await apiClient.get<FeedingSchedule[]>('/feeding/schedules');
      setFeedingSchedules(response.data || []);
    } catch (error) {
      console.error('Failed to load feeding schedules', error);
    } finally {
      setFeedingLoading(false);
    }
  };

  useEffect(() => {
    void loadFeedingSchedules();
  }, []);

  useEffect(() => {
    const loadPredictiveBundle = async () => {
      try {
        const response = await apiClient.get<{
          predictiveWarning: PredictiveAnalyticsResult;
          predictionHistory: PredictionLog[];
          smsLogs: SmsLogEntry[];
        }>('/water/dashboard');

        setPredictiveWarning(response.data.predictiveWarning);
        setSmsLogs(response.data.smsLogs || []);
      } catch (error) {
        console.error('Failed to load predictive bundle', error);
      }
    };

    void loadPredictiveBundle();
    const interval = setInterval(() => {
      void loadPredictiveBundle();
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await apiClient.logout();
    } finally {
      localStorage.removeItem('user');
    }
    navigate('/login');
  };

  const triggerManual = async (action: 'ON' | 'OFF' | 'TRIGGER') => {
    try {
      setManualBusy(true);
      await apiClient.post('/feeding/manual', { action });
      await loadFeedingSchedules();
    } catch (error) {
      console.error('Failed to trigger manual command', error);
    } finally {
      setManualBusy(false);
    }
  };

  const addSchedule = async () => {
    if (!scheduleTime) return;
    try {
      setFeedingLoading(true);
      await apiClient.post('/feeding/schedules', {
        date: scheduleDate || null,
        time: scheduleTime,
        label: scheduleLabel || null,
      });
      setScheduleDate('');
      setScheduleTime('');
      setScheduleLabel('');
      await loadFeedingSchedules();
    } catch (error) {
      console.error('Failed to add feeding schedule', error);
      setFeedingLoading(false);
    }
  };

  const toggleSchedule = async (item: FeedingSchedule) => {
    try {
      setFeedingLoading(true);
      await apiClient.put(`/feeding/schedules/${item.id}`, {
        enabled: !item.enabled,
      });
      await loadFeedingSchedules();
    } catch (error) {
      console.error('Failed to update schedule', error);
      setFeedingLoading(false);
    }
  };

  const removeSchedule = async (id: string) => {
    try {
      setFeedingLoading(true);
      await apiClient.delete(`/feeding/schedules/${id}`);
      await loadFeedingSchedules();
    } catch (error) {
      console.error('Failed to remove schedule', error);
      setFeedingLoading(false);
    }
  };

  const startEditSchedule = (item: FeedingSchedule) => {
    setEditingScheduleId(item.id);
    setEditDate(item.date || '');
    setEditTime(item.time);
    setEditLabel(item.label || '');
  };

  const cancelEditSchedule = () => {
    setEditingScheduleId(null);
    setEditDate('');
    setEditTime('');
    setEditLabel('');
  };

  const saveEditSchedule = async (id: string) => {
    if (!editTime) return;
    try {
      setFeedingLoading(true);
      await apiClient.put(`/feeding/schedules/${id}`, {
        date: editDate || null,
        time: editTime,
        label: editLabel || null,
      });
      cancelEditSchedule();
      await loadFeedingSchedules();
    } catch (error) {
      console.error('Failed to edit schedule', error);
      setFeedingLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0b10] text-gray-200">
      <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-white/10 bg-[#101116] p-5 lg:min-h-screen lg:border-b-0 lg:border-r">
          <div className="mb-6">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">AquaSense</p>
            <h1 className="mt-2 text-xl font-bold text-white">Water Quality Console</h1>
            <p className="mt-1 text-xs text-gray-400">Dark operations panel</p>
          </div>

          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wider text-gray-500 uppercase">Sections</p>
              <div className="space-y-2 text-sm">
                <button onClick={() => goToSection('overview')} className={`w-full rounded-lg px-3 py-2 text-left ${activeSection === 'overview' ? 'border border-white/10 bg-[#1a1b22] text-white' : 'text-gray-400 hover:bg-[#16171d]'}`}>Overview</button>
                <button onClick={() => goToSection('parameters')} className={`w-full rounded-lg px-3 py-2 text-left ${activeSection === 'parameters' ? 'border border-white/10 bg-[#1a1b22] text-white' : 'text-gray-400 hover:bg-[#16171d]'}`}>Parameters</button>
                <button onClick={() => goToSection('feeding')} className={`w-full rounded-lg px-3 py-2 text-left ${activeSection === 'feeding' ? 'border border-white/10 bg-[#1a1b22] text-white' : 'text-gray-400 hover:bg-[#16171d]'}`}>Feeding</button>
                <button onClick={() => goToSection('alerts')} className={`w-full rounded-lg px-3 py-2 text-left ${activeSection === 'alerts' ? 'border border-white/10 bg-[#1a1b22] text-white' : 'text-gray-400 hover:bg-[#16171d]'}`}>Alerts & Logs</button>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-wider text-gray-500 uppercase">System</p>
              <div className="space-y-2 rounded-xl border border-white/10 bg-[#15161c] p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Connection</span>
                  <span className={isConnected ? 'text-emerald-400' : 'text-rose-400'}>{isConnected ? 'Online' : 'Offline'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Battery</span>
                  <span className="text-amber-300">Unavailable</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Water level</span>
                  <span className="text-amber-300">Unavailable</span>
                </div>
              </div>
            </div>

            <button onClick={handleLogout} className="w-full px-3 py-2 text-sm font-semibold text-white rounded-lg bg-rose-600 hover:bg-rose-500">
              Logout
            </button>
          </div>
        </aside>

        <main className="p-4 md:p-6 lg:p-8">
          <header id="overview" className="mb-6 rounded-2xl border border-white/10 bg-gradient-to-r from-[#1a1b22] to-[#121317] p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">Live Monitoring Dashboard</h2>
                <p className="text-sm text-gray-400">Black and gray command center layout</p>
              </div>
              <div className={`rounded-full px-3 py-1 text-sm font-semibold ${isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
          </header>

          {wsError && <div className="p-4 mb-6 text-sm border rounded-xl border-rose-500/40 bg-rose-500/10 text-rose-200">Connection error: {wsError}</div>}

          <section className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-[#14151b] p-4">
              <p className="text-xs tracking-wide text-gray-500 uppercase">Health Score</p>
              <p className="mt-2 text-3xl font-bold text-white">{statistics?.healthScore != null ? Math.round(statistics.healthScore) : '--'}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#14151b] p-4">
              <p className="text-xs tracking-wide text-gray-500 uppercase">Battery</p>
              <p className="mt-2 text-3xl font-bold text-amber-300">Unavailable</p>
              <p className="mt-1 text-xs text-gray-500">No battery telemetry is available.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#14151b] p-4">
              <p className="text-xs tracking-wide text-gray-500 uppercase">Water Level</p>
              <p className="mt-2 text-3xl font-bold text-amber-300">Unavailable</p>
              <p className="mt-1 text-xs text-gray-500">No level sensor is installed.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#14151b] p-4">
              <p className="text-xs tracking-wide text-gray-500 uppercase">Level Sensor</p>
              <p className="mt-2 text-sm font-semibold text-amber-300">Not installed / uncommissioned</p>
              <p className="mt-1 text-xs text-gray-500">Level-based automation is unavailable.</p>
            </div>
          </section>

          {predictiveWarning && (
            <section className="mb-6 rounded-xl border border-amber-400/30 bg-[#18161a] p-5">
              <h3 className="text-lg font-semibold text-white">Predictive Warning</h3>
              <div className="grid grid-cols-1 gap-2 mt-3 text-sm md:grid-cols-2">
                <p><span className="text-gray-400">Risk:</span> {predictiveWarning.warningCard.riskLevel}</p>
                <p><span className="text-gray-400">Confidence:</span> {predictiveWarning.warningCard.confidence}%</p>
                <p><span className="text-gray-400">Issue:</span> {predictiveWarning.warningCard.predictedIssue}</p>
                <p><span className="text-gray-400">Action:</span> {predictiveWarning.warningCard.action}</p>
              </div>
            </section>
          )}

          {statistics ? (
            <section id="parameters" className="grid grid-cols-1 gap-4 mb-6 xl:grid-cols-2">
              {[
                { key: 'temperature', label: 'Temperature (C)', color: '#fb923c', fill: '#7c2d12' },
                { key: 'ph', label: 'pH Level', color: '#a78bfa', fill: '#4c1d95' },
                { key: 'do', label: 'Dissolved Oxygen', color: '#34d399', fill: '#064e3b' },
                { key: 'turbidity', label: 'Turbidity', color: '#facc15', fill: '#713f12' },
              ].map((item) => (
                <div key={item.key} className="rounded-xl border border-white/10 bg-[#14151b] p-4">
                  <h4 className="mb-4 text-sm font-semibold tracking-wide text-gray-400 uppercase">{item.label}</h4>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={chartData.slice(-20)}>
                      <defs>
                        <linearGradient id={`legacy-${item.key}-gradient`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={item.color} stopOpacity={0.5} />
                          <stop offset="55%" stopColor={item.fill} stopOpacity={0.22} />
                          <stop offset="100%" stopColor={item.fill} stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2c35" vertical={false} />
                      <XAxis dataKey="time" stroke="#6b7280" style={{ fontSize: '11px' }} />
                      <YAxis stroke="#6b7280" style={{ fontSize: '11px' }} />
                      <Tooltip contentStyle={{ backgroundColor: '#101014', border: '1px solid #2a2c35', borderRadius: '10px', color: '#f3f4f6' }} />
                      <Area
                        type="monotone"
                        dataKey={item.key}
                        stroke={item.color}
                        fill={`url(#legacy-${item.key}-gradient)`}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0, fill: item.color }}
                        strokeWidth={2.5}
                        isAnimationActive
                        animationDuration={450}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </section>
          ) : (
            <div className="mb-6 rounded-xl border border-white/10 bg-[#14151b] p-8 text-center text-gray-400">Loading sensor data...</div>
          )}

          <section id="feeding" className="grid grid-cols-1 gap-4 mb-6 xl:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#14151b] p-4">
              <h3 className="mb-3 text-lg font-semibold text-white">Feeding Control</h3>
              <div className="grid grid-cols-3 gap-2">
                <button disabled={manualBusy} onClick={() => triggerManual('ON')} className="px-3 py-2 text-sm font-semibold text-white rounded-lg bg-emerald-600">ON</button>
                <button disabled={manualBusy} onClick={() => triggerManual('OFF')} className="px-3 py-2 text-sm font-semibold text-white rounded-lg bg-rose-600">OFF</button>
                <button disabled={manualBusy} onClick={() => triggerManual('TRIGGER')} className="px-3 py-2 text-sm font-semibold text-white rounded-lg bg-slate-600">Feed</button>
              </div>
              <div className="grid grid-cols-1 gap-2 mt-3 md:grid-cols-3">
                <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className="rounded-lg border border-white/10 bg-[#0f1015] px-3 py-2 text-sm text-gray-200" />
                <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className="rounded-lg border border-white/10 bg-[#0f1015] px-3 py-2 text-sm text-gray-200" />
                <input type="text" value={scheduleLabel} onChange={(e) => setScheduleLabel(e.target.value)} placeholder="Label" className="rounded-lg border border-white/10 bg-[#0f1015] px-3 py-2 text-sm text-gray-200" />
              </div>
              <button disabled={feedingLoading || !scheduleTime} onClick={addSchedule} className="px-4 py-2 mt-3 text-sm font-semibold text-white rounded-lg bg-cyan-600 disabled:opacity-40">Save Schedule</button>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#14151b] p-4">
              <h3 className="mb-3 text-lg font-semibold text-white">Scheduled Feedings</h3>
              {feedingLoading ? (
                <p className="text-sm text-gray-400">Loading schedules...</p>
              ) : feedingSchedules.length === 0 ? (
                <p className="text-sm text-gray-400">No schedules yet.</p>
              ) : (
                <div className="space-y-2">
                  {feedingSchedules.map((item) => (
                    <div key={item.id} className="rounded-lg border border-white/10 bg-[#101117] p-3">
                      {editingScheduleId === item.id ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                            <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="rounded-lg border border-white/10 bg-[#0f1015] px-3 py-2 text-sm text-gray-200" />
                            <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="rounded-lg border border-white/10 bg-[#0f1015] px-3 py-2 text-sm text-gray-200" />
                            <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="rounded-lg border border-white/10 bg-[#0f1015] px-3 py-2 text-sm text-gray-200" />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => saveEditSchedule(item.id)} className="px-3 py-2 text-xs font-semibold text-white rounded-lg bg-cyan-600">Save</button>
                            <button onClick={cancelEditSchedule} className="px-3 py-2 text-xs font-semibold text-white rounded-lg bg-slate-600">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-white">{item.date ? `${item.date} ` : 'Daily '}@ {item.time}</p>
                            {item.label && <p className="text-xs text-gray-400">{item.label}</p>}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => startEditSchedule(item)} className="rounded-lg bg-slate-600 px-3 py-1.5 text-xs text-white">Edit</button>
                            <button onClick={() => toggleSchedule(item)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white">{item.enabled ? 'Disable' : 'Enable'}</button>
                            <button onClick={() => removeSchedule(item.id)} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs text-white">Remove</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section id="alerts" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#14151b] p-4">
              <h3 className="mb-3 text-lg font-semibold text-white">Recent Alerts</h3>
              {alerts.length === 0 ? (
                <p className="text-sm text-emerald-300">All clear. No active alerts.</p>
              ) : (
                <div className="space-y-2 overflow-y-auto max-h-80">
                  {alerts.map((alert) => (
                    <div key={alert.id} className="rounded-lg border border-white/10 bg-[#101117] p-3">
                      <p className="text-sm font-semibold text-white capitalize">{(alert.parameter || alert.category || 'Water quality').replace(/_/g, ' ')} alert</p>
                      <p className="text-sm text-gray-300">{alert.message}</p>
                      <p className="text-xs text-gray-500">{new Date(alert.timestamp || alert.createdAt || Date.now()).toLocaleTimeString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-[#14151b] p-4">
              <h3 className="mb-3 text-lg font-semibold text-white">SMS Logs</h3>
              {smsLogs.length === 0 ? (
                <p className="text-sm text-gray-400">No SMS logs yet.</p>
              ) : (
                <div className="space-y-2 overflow-y-auto max-h-80">
                  {smsLogs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-[#101117] p-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{log.category} ({log.severity})</p>
                        <p className="text-xs text-gray-500">{new Date(log.sentAt).toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">{log.recipient}</p>
                        <p className={`text-sm font-semibold ${log.success ? 'text-emerald-400' : 'text-rose-400'}`}>{log.success ? 'Sent' : 'Failed'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};
