'use client';

import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface TopbarProps {
  greeting: string;
  subtext: string;
  notificationCount?: number;
  className?: string;
}

export function Topbar({ greeting, subtext, notificationCount = 0, className }: TopbarProps) {
  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      };
      setCurrentTime(now.toLocaleDateString('es-ES', options));
    };
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={cn('bg-white border-b border-slate-200/70', className)}>
      <div className="flex items-center justify-between max-w-[1600px] mx-auto px-8 py-4">
        <div>
          <h2 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)]">
            {greeting}
          </h2>
          <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)] mt-0.5">
            {subtext} · {currentTime}
          </p>
        </div>
        {notificationCount > 0 && (
          <button
            className="relative w-9 h-9 rounded-xl bg-[var(--color-page-bg)] flex items-center justify-center hover:bg-slate-200 transition-colors"
            aria-label="Notificaciones"
          >
            <Bell className="w-[18px] h-[18px] text-[var(--color-brand-muted)]" strokeWidth={1.75} />
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[var(--color-brand-cyan)] text-white text-[9px] font-bold flex items-center justify-center">
              {notificationCount}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
