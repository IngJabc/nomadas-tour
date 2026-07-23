'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/notifications/NotificationBell';

interface TopbarProps {
  greeting: string;
  subtext: string;
  notificationCount?: number;
  role?: string;
  className?: string;
}

export function Topbar({ greeting, subtext, role, className }: TopbarProps) {
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
        {role && <NotificationBell role={role} />}
      </div>
    </div>
  );
}
