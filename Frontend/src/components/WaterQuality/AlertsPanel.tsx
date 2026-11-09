/**
 * Alerts Panel Component
 * Displays recent water quality alerts and warnings.
 */
import React from 'react';
import type { HealthAlert } from '../../types/water';

interface AlertsPanelProps {
  alerts: HealthAlert[];
}

export const AlertsPanel: React.FC<AlertsPanelProps> = ({ alerts }) => {
  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'critical':
      case 'emergency':
        return 'bg-[#101117] border-l-rose-500 text-white';
      case 'warning':
        return 'bg-[#101117] border-l-amber-500 text-white';
      case 'info':
        return 'bg-[#101117] border-l-sky-500 text-white';
      default:
        return 'bg-[#101117] border-l-white/10 text-gray-200';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'critical':
      case 'emergency':
        return '!';
      case 'warning':
        return '~';
      case 'info':
        return 'i';
      default:
        return '-';
    }
  };

  const formatTime = (date?: Date | string) => {
    const d = new Date(date || '');
    if (Number.isNaN(d.getTime())) {
      return '--:--';
    }
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const getCategory = (alert: HealthAlert) =>
    (alert.parameter || alert.category || 'water quality').replace(/_/g, ' ').toLowerCase();

  const getValue = (alert: HealthAlert) => {
    const value = alert.value ?? alert.currentValue;
    if (value === undefined) return '--';
    return `${value.toFixed(2)}${alert.unit ? ` ${alert.unit}` : ''}`;
  };

  return (
    <div className="rounded-xl border border-white/10 bg-[#14151b] p-4">
      <h3 className="text-lg font-semibold text-white mb-4">Recent Alerts</h3>

      {alerts.length === 0 ? (
        <div className="text-center py-6 text-gray-400">
          <p className="text-sm">No alerts at this time</p>
          <p className="text-xs mt-2">Water quality is stable</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-56 overflow-y-auto pr-2 scrollbar-modern">
          {alerts.map((alert) => (
            <div key={alert.id} className={`border-l-4 rounded-lg p-3 ${getSeverityColor(alert.severity)}`}>
              <div className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0 text-white/90">{getSeverityIcon(alert.severity)}</span>
                <div className="flex-grow min-w-0">
                  <p className="font-semibold text-sm capitalize text-white">{getCategory(alert)}</p>
                  <p className="text-sm text-gray-300 mt-1">{alert.message}</p>
                  <div className="flex justify-between items-center mt-2 text-xs text-gray-400">
                    <span>Value: {getValue(alert)}</span>
                    <span>{formatTime(alert.timestamp || alert.createdAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
