/**
 * Health Score Indicator Component
 * Displays the overall water quality health score with visual gauge
 */
import React from 'react';

interface HealthScoreProps {
  score: number; // 0-100
}

export const HealthScore: React.FC<HealthScoreProps> = ({ score }) => {
  const getScoreColor = (s: number) => {
    if (s >= 80) return 'text-green-600';
    if (s >= 60) return 'text-blue-600';
    if (s >= 40) return 'text-yellow-600';
    if (s >= 20) return 'text-orange-600';
    return 'text-red-600';
  };

  const getScoreGradient = (s: number) => {
    if (s >= 80) return 'from-green-400 to-green-600';
    if (s >= 60) return 'from-blue-400 to-blue-600';
    if (s >= 40) return 'from-yellow-400 to-yellow-600';
    if (s >= 20) return 'from-orange-400 to-orange-600';
    return 'from-red-400 to-red-600';
  };

  const getStatusLabel = (s: number) => {
    if (s >= 80) return 'Excellent';
    if (s >= 60) return 'Good';
    if (s >= 40) return 'Fair';
    if (s >= 20) return 'Poor';
    return 'Critical';
  };

  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg shadow-md">
      <div className="relative w-32 h-32 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
          {/* Background circle */}
          <circle cx="60" cy="60" r="45" fill="none" stroke="#e2e8f0" strokeWidth="8" />
          {/* Progress circle */}
          <circle
            cx="60"
            cy="60"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={`transition-all duration-1000 ${getScoreColor(score)}`}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-bold ${getScoreColor(score)}`}>{Math.round(score)}</span>
          <span className="text-xs text-gray-500">Health</span>
        </div>
      </div>

      <div className="mt-6 text-center">
        <p className={`text-lg font-semibold ${getScoreColor(score)}`}>{getStatusLabel(score)}</p>
        <p className="text-sm text-gray-600 mt-2">Water Quality Rating</p>
      </div>

      {/* Status indicator bar */}
      <div className="w-full mt-6 bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full bg-gradient-to-r ${getScoreGradient(score)} transition-all duration-1000`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
};
