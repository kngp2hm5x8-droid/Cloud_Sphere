import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateTime } from '@/lib/formatting';

export interface MetricPoint { logged_at: string; cpu_pct: number | string; ram_pct: number | string; disk_pct: number | string; net_in_kbps?: number | string; net_out_kbps?: number | string; }
export default function MetricsChart({ data }: { data: MetricPoint[] }) {
  const points = data.map((p) => ({ ...p, cpu: Number(p.cpu_pct), ram: Number(p.ram_pct), disk: Number(p.disk_pct), time: p.logged_at }));
  return <div style={{ width: '100%', height: 300 }}><ResponsiveContainer>
    <LineChart data={points} margin={{ top: 8, right: 16, left: -16, bottom: 4 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--cs-border)" />
      <XAxis dataKey="time" tickFormatter={(v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} />
      <YAxis domain={[0, 100]} unit="%" />
      <Tooltip labelFormatter={(v) => formatDateTime(String(v))} formatter={(v) => [`${Number(v).toFixed(1)}%`]} />
      <Legend /><Line type="monotone" dataKey="cpu" name="CPU" stroke="#4f46e5" dot={false} strokeWidth={2} connectNulls />
      <Line type="monotone" dataKey="ram" name="Memory" stroke="#0891b2" dot={false} strokeWidth={2} connectNulls />
      <Line type="monotone" dataKey="disk" name="Disk" stroke="#16a34a" dot={false} strokeWidth={2} connectNulls />
    </LineChart>
  </ResponsiveContainer></div>;
}
