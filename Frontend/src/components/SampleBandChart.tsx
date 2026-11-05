import React from 'react';

// Static illustration of the dashboard's band chart for the public pages.
// Values are sample data and are labelled as such wherever this is shown.
const sample = [27.1, 27.3, 27.2, 27.6, 27.9, 28.3, 28.6, 28.9, 29.3, 29.6, 29.4, 29.0, 28.6, 28.3, 28.1, 27.8, 27.6, 27.7, 27.5, 27.4];

const SampleBandChart: React.FC<{ className?: string }> = ({ className = '' }) => {
  const width = 320;
  const height = 132;
  const min = 24;
  const max = 32;
  const y = (value: number) => height - ((value - min) / (max - min)) * height;
  const x = (index: number) => (index / (sample.length - 1)) * width;
  const path = sample.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  const bandTop = y(29);
  const bandBottom = y(26);
  const outside = sample.map((value, index) => ({ value, index })).filter((point) => point.value > 29);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label="Sample temperature trend with the 26 to 29 °C guidance range shaded">
      <rect x="0" y="0" width={width} height={bandTop} fill="#f1e9d2" opacity="0.7" />
      <rect x="0" y={bandBottom} width={width} height={height - bandBottom} fill="#f1e9d2" opacity="0.7" />
      <rect x="0" y={bandTop} width={width} height={bandBottom - bandTop} fill="#e1eef6" />
      <line x1="0" x2={width} y1={bandTop} y2={bandTop} stroke="#7aaecb" strokeDasharray="4 3" />
      <line x1="0" x2={width} y1={bandBottom} y2={bandBottom} stroke="#7aaecb" strokeDasharray="4 3" />
      <path d={path} fill="none" stroke="#0f2a3d" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {outside.map((point) => <circle key={point.index} cx={x(point.index)} cy={y(point.value)} r="2.6" fill="#a14e06" />)}
    </svg>
  );
};

export default SampleBandChart;
