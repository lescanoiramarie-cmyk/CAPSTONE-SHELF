import { useEffect, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';

ChartJS.register(
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip
);

export default function ChartRenderer({ type = 'bar', options = {}, data, ...props }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const update = () => setDark(document.documentElement.classList.contains('dark'));
    window.addEventListener('shelf_dark_mode_changed', update);
    return () => window.removeEventListener('shelf_dark_mode_changed', update);
  }, []);
  const isAdmin = Boolean(document.querySelector('.subadmin-dashboard, .superadmin-dashboard'));
  const ChartComponent = type === 'line' ? Line : Bar;
  if (!dark || !isAdmin) return <ChartComponent data={data} options={options} {...props} />;
  const scales = Object.fromEntries(['x', 'y'].map((axis) => {
    const scale = options.scales?.[axis] || {};
    return [axis, { ...scale, ticks: { ...scale.ticks, color: '#cbd5e1' }, grid: { ...scale.grid, color: 'rgba(148, 163, 184, 0.2)' } }];
  }));
  const darkOptions = {
    ...options,
    color: '#cbd5e1',
    scales: { ...options.scales, ...scales },
    plugins: { ...options.plugins, legend: { ...options.plugins?.legend, labels: { ...options.plugins?.legend?.labels, color: '#cbd5e1' } } },
  };
  const darkData = { ...data, datasets: data.datasets.map((dataset) => ({
    ...dataset,
    borderColor: dataset.borderColor === '#002046' ? '#93c5fd' : dataset.borderColor,
    backgroundColor: dataset.backgroundColor === '#002046' ? '#93c5fd' : dataset.backgroundColor,
  })) };
  return <ChartComponent data={darkData} options={darkOptions} {...props} />;
}
