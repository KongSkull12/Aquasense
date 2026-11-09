/**
 * Water Quality Parameter Card Component
 * Displays a single water quality parameter with real-time data
 */
import React from 'react';

interface ParameterCardProps {
  label: string;
  current: number;
  average: number;
  min: number;
  max: number;
  unit: string;
  icon: string;
  status: 'normal' | 'warning' | 'critical';
}

export const ParameterCard: React.FC<ParameterCardProps> = ({
  label,
  current,
  average,
  min,
  max,
  unit,
  icon,
  status,
}) => {
  const statusStyles = {
    normal: {
      card: 'bg-white border-l-4 border-green-500 hover:shadow-lg hover:border-green-600',
      badge: 'badge-success',
      text: 'text-green-800',
      icon: 'text-green-400',
    },
    warning: {
      card: 'bg-white border-l-4 border-yellow-500 hover:shadow-lg hover:border-yellow-600',
      badge: 'badge-warning',
      text: 'text-yellow-800',
      icon: 'text-yellow-400',
    },
    critical: {
      card: 'bg-white border-l-4 border-red-500 hover:shadow-lg hover:border-red-600',
      badge: 'badge-danger',
      text: 'text-red-800',
      icon: 'text-red-400',
    },
  };

  const style = statusStyles[status];

  return (
    <div className={`card ${style.card} pl-5`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-bold text-gray-900">{current.toFixed(1)}</span>
            <span className="text-lg text-gray-500 font-medium">{unit}</span>
          </div>
        </div>
        <div className={`text-4xl ${style.icon}`}>{icon}</div>
      </div>

      {/* Status Badge */}
      <div className={`${style.badge} mb-4 uppercase text-xs tracking-wider`}>
        {status}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Average</p>
          <p className="text-lg font-semibold text-gray-900">{average.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Min</p>
          <p className="text-lg font-semibold text-gray-900">{min.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Max</p>
          <p className="text-lg font-semibold text-gray-900">{max.toFixed(1)}</p>
        </div>
      </div>
    </div>
  );
};
