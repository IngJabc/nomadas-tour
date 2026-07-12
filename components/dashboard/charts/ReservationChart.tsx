'use client';

import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

interface ReservationChartProps {
  data: { date: string; count: number }[];
  loading?: boolean;
}

export function ReservationChart({ data, loading }: ReservationChartProps) {
  const formatted = data.map(d => ({
    date: d.date.slice(5),
    count: d.count,
  }));

  return (
    <Card className="p-5">
      <h3 className="font-[family-name:var(--font-body)] font-semibold text-[15px] text-[var(--color-brand-navy)] mb-4">
        Reservas de {format(new Date(), 'MMMM', { locale: es }).replace(/^./, c => c.toUpperCase())}
      </h3>
      {loading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={formatted} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fontFamily: 'var(--font-body)', fill: '#6b7280' }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fontFamily: 'var(--font-body)', fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.06)',
                  fontSize: 12,
                  fontFamily: 'var(--font-body)',
                }}
              />
              <Bar
                dataKey="count"
                fill="var(--color-brand-cyan)"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
