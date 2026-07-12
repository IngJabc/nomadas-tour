'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

const PAGE_SIZE = 4;

interface OccupancyData {
  trip_id: string;
  label: string;
  departure: string;
  total: number;
  reserved: number;
  occupancy_pct: number;
}

interface OccupancyChartProps {
  data: OccupancyData[];
  loading?: boolean;
}

export function OccupancyChart({ data, loading }: OccupancyChartProps) {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(0);
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, data.length);
  const pageData = data.slice(start, end);

  const goPrev = () => {
    setDirection(-1);
    setPage((p) => Math.max(0, p - 1));
  };

  const goNext = () => {
    setDirection(1);
    setPage((p) => Math.min(totalPages - 1, p + 1));
  };

  const formatted = pageData.map(d => ({
    name: d.label,
    pct: d.occupancy_pct,
    reserved: d.reserved,
    total: d.total,
  }));

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-[family-name:var(--font-body)] font-semibold text-[15px] text-[var(--color-brand-navy)]">
          Ocupación de viajes
        </h3>
        {!loading && data.length > PAGE_SIZE && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goPrev}
              disabled={safePage === 0}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent border-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-[var(--color-brand-muted)] hover:bg-slate-100 hover:text-[var(--color-brand-navy)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
            </button>
            <span className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] tabular-nums min-w-[52px] text-center select-none">
              {start + 1}–{end} de {data.length}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={safePage >= totalPages - 1}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent border-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-[var(--color-brand-muted)] hover:bg-slate-100 hover:text-[var(--color-brand-navy)] transition-colors"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : (
        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={safePage}
              custom={direction}
              variants={{
                enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.18, ease: 'easeInOut' }}
            >
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={formatted}
                    layout="vertical"
                    margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fontFamily: 'var(--font-body)', fill: '#6b7280' }}
                      axisLine={{ stroke: '#e5e7eb' }}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 10, fontFamily: 'var(--font-body)', fill: '#6b7280' }}
                      axisLine={false}
                      tickLine={false}
                      width={90}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 10,
                        border: '1px solid rgba(0,0,0,0.06)',
                        fontSize: 12,
                        fontFamily: 'var(--font-body)',
                      }}
                    />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]} maxBarSize={16}>
                      {formatted.map((_, i) => (
                        <Cell
                          key={i}
                          fill={formatted[i].pct >= 80 ? '#10b981' : formatted[i].pct >= 50 ? '#f59e0b' : 'var(--color-brand-cyan)'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
