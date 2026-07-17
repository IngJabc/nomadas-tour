'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Plus, UserCheck, Ticket, Calendar, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

const PAGE_SIZE = 4;

interface ActivityItem {
  type: 'trip_created' | 'trip_assigned' | 'reservation_created' | 'reservation_cancelled' | 'boarding';
  label: string;
  timestamp: string;
  description?: string;
  actor?: string | null;
}

interface ActivityWidgetProps {
  activities: ActivityItem[];
  loading?: boolean;
}

function ActivityIcon({ type }: { type: ActivityItem['type'] }) {
  const cfg = {
    trip_created: { icon: Plus, bg: 'bg-[rgba(0,212,255,0.1)]', color: 'text-[var(--color-brand-cyan)]' },
    trip_assigned: { icon: Calendar, bg: 'bg-[rgba(139,92,246,0.1)]', color: 'text-[#8b5cf6]' },
    reservation_created: { icon: Ticket, bg: 'bg-[rgba(245,158,11,0.1)]', color: 'text-[#f59e0b]' },
    reservation_cancelled: { icon: XCircle, bg: 'bg-red-50', color: 'text-[#ef4444]' },
    boarding: { icon: UserCheck, bg: 'bg-[rgba(16,185,129,0.1)]', color: 'text-[#10b981]' },
  }[type];
  const Icon = cfg.icon;
  return (
    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg}`}>
      <Icon className={`w-4 h-4 ${cfg.color}`} strokeWidth={1.75} />
    </div>
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

export function ActivityWidget({ activities, loading }: ActivityWidgetProps) {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(0);
  const totalPages = Math.max(1, Math.ceil(activities.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, activities.length);
  const displayed = activities.slice(start, end);

  const goPrev = () => {
    setDirection(-1);
    setPage((p) => Math.max(0, p - 1));
  };

  const goNext = () => {
    setDirection(1);
    setPage((p) => Math.min(totalPages - 1, p + 1));
  };

  return (
    <Card className="p-5 h-[500px]">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h3 className="font-[family-name:var(--font-body)] font-semibold text-[15px] text-[var(--color-brand-navy)] flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
          Actividad reciente
        </h3>
        {!loading && activities.length > PAGE_SIZE && (
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
              {start + 1}–{end} de {activities.length}
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
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3 h-[104px]">
              <Skeleton className="w-8 h-8 rounded-lg" />
              <div className="flex-1">
                <Skeleton className="h-3 w-3/4 mb-1" />
                <Skeleton className="h-2.5 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          icon={<Clock className="w-8 h-8" />}
          message="No hay actividad reciente"
        />
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
              className="flex flex-col"
            >
              {displayed.map((item, i) => (
                <div
                  key={start + i}
                  className="flex items-center gap-3 border-b border-[rgba(0,0,0,0.04)] last:border-0 h-[104px]"
                >
                  <ActivityIcon type={item.type} />
                  <div className="flex-1 min-w-0 flex items-center">
                    <div>
                      <p className="font-[family-name:var(--font-body)] font-normal text-[13px] text-[var(--color-brand-navy)] truncate">
                        {item.label}
                      </p>
                      <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] flex items-center gap-1.5">
                        <span>{timeAgo(item.timestamp)}</span>
                        {item.actor && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-[#d1d5db]" />
                            <span>{item.actor}</span>
                          </>
                        )}
                      </p>
                      {item.description && (
                        <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] mt-0.5">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
