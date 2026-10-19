import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateTime } from '@/lib/formatting';

export interface MetricPoint { logged_at: string; cpu_pct: number | string; ram_pct: number | string; disk_pct: number | string; net_in_kbps?: number | string; net_out_kbps?: number | string; }
export default function MetricsChart({ data }: { data: MetricPoint[] }) {
  const points = data.map((p) => ({ ...p, cpu: Number(p.cpu_pct), ram: Number(p.ram_pct), disk: Number(p.disk_pct), time: p.logged_at }));
  return <div className="cs-chart-card" style={{ width: '100%', height: 310 }}><ResponsiveContainer>
    <LineChart data={points} margin={{ top: 8, right: 16, left: -16, bottom: 4 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--cs-border)" />
      <XAxis dataKey="time" axisLine={false} tickLine={false} tickFormatter={(v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} />
      <YAxis domain={[0, 100]} unit="%" axisLine={false} tickLine={false} width={42} />
      <Tooltip labelFormatter={(v) => formatDateTime(String(v))} formatter={(v) => [`${Number(v).toFixed(1)}%`]} contentStyle={{ border: '1px solid var(--cs-border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(16,47,77,.12)' }} />
      <Legend verticalAlign="top" height={34} /><Line type="monotone" dataKey="cpu" name="CPU" stroke="#173d5d" dot={false} activeDot={{ r: 4 }} strokeWidth={2.4} connectNulls />
      <Line type="monotone" dataKey="ram" name="Memory" stroke="#168f98" dot={false} activeDot={{ r: 4 }} strokeWidth={2.4} connectNulls />
      <Line type="monotone" dataKey="disk" name="Disk" stroke="#d59a38" dot={false} activeDot={{ r: 4 }} strokeWidth={2.2} connectNulls />
    </LineChart>
  </ResponsiveContainer></div>;
}
