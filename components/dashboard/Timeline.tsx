'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, MapPin, Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

const PAGE_SIZE = 4;

interface TimelineItem {
  id: string;
  departure_time: string;
  route: { origin: string; destination: string } | null;
  capacity: number;
  available_seats: number;
  reservation_count: number;
}

interface TimelineProps {
  items: TimelineItem[];
  loading?: boolean;
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const mins = String(d.getUTCMinutes()).padStart(2, '0');
    return { date: `${day}/${month}`, time: `${hours}:${mins}` };
  } catch {
    return { date: '—', time: '—' };
  }
}

export function Timeline({ items, loading }: TimelineProps) {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, items.length);
  const displayed = items.slice(start, end);

  const goPrev = () => {
    setDirection(-1);
    setPage((p) => Math.max(0, p - 1));
  };

  const goNext = () => {
    setDirection(1);
    setPage((p) => Math.min(totalPages - 1, p + 1));
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-[family-name:var(--font-body)] font-semibold text-[15px] text-[var(--color-brand-navy)] flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
          Próximos viajes
        </h3>
        {!loading && items.length > PAGE_SIZE && (
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
              {start + 1}–{end} de {items.length}
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
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-4">
              <Skeleton className="w-14 h-10 rounded-lg shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-3 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Calendar className="w-8 h-8" />}
          message="No hay viajes próximos"
        />
      ) : (
        <div className="relative overflow-hidden">
          <div className="absolute left-[27px] top-2 bottom-2 w-px bg-slate-200" />
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
              <div className="space-y-0">
                {displayed.map((item, i) => {
                  const { date, time } = formatDate(item.departure_time);
                  const route = item.route;
                  const occupancyPct = item.capacity > 0
                    ? Math.round(((item.capacity - item.available_seats) / item.capacity) * 100)
                    : 0;
                  const isLast = i === displayed.length - 1;

                  return (
                    <div key={item.id} className={`flex gap-4 ${!isLast ? 'pb-5' : ''}`}>
                      <div className="flex flex-col items-center shrink-0">
                        <div className="w-[54px] text-center">
                          <p className="font-[family-name:var(--font-heading)] font-extrabold text-[11px] text-[var(--color-brand-navy)] leading-tight uppercase">
                            {date}
                          </p>
                          <p className="font-[family-name:var(--font-body)] font-semibold text-[10px] text-[var(--color-brand-muted)] leading-tight">
                            {time}
                          </p>
                        </div>
                        {!isLast && <div className="w-px flex-1 bg-slate-200 mt-2" />}
                      </div>
                      <div className="flex-1 min-w-0 pb-2">
                        <div className="flex items-center gap-2 mb-1">
                          <MapPin className="w-3.5 h-3.5 text-[var(--color-brand-muted)] shrink-0" strokeWidth={1.75} />
                          <p className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-navy)] truncate">
                            {route?.origin || '?'} → {route?.destination || '?'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            <Users className="w-3 h-3 text-[var(--color-brand-muted)]" strokeWidth={1.75} />
                            <span className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)]">
                              {item.reservation_count} res.
                            </span>
                          </div>
                          <Badge variant={occupancyPct >= 80 ? 'warning' : 'active'} size="xs">
                            {occupancyPct}% ocupado
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
