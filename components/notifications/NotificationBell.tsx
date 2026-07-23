'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useNotifications } from './NotificationProvider';
import { NotificationDropdown } from './NotificationDropdown';
import { Badge } from '@/components/ui/Badge';

interface NotificationBellProps {
  role: string;
}

export function NotificationBell({ role }: NotificationBellProps) {
  const { unreadCount, hasCriticalUnread } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [open]);

  const iconColor = hasCriticalUnread
    ? 'text-[var(--color-danger)]'
    : 'text-white';

  const badgeVariant = hasCriticalUnread ? 'danger' : 'count';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="relative w-9 h-9 rounded-xl bg-[var(--color-brand-navy)] flex items-center justify-center hover:bg-[var(--color-brand-blue)] transition-colors cursor-pointer border-none group"
        aria-label="Notificaciones"
      >
        <Bell
          className={`w-[18px] h-[18px] ${iconColor} group-hover:text-white transition-colors`}
          strokeWidth={1.75}
        />
        {unreadCount > 0 && (
          <Badge
            variant={badgeVariant}
            size="xs"
            className="absolute -top-0.5 -right-0.5 font-[family-name:var(--font-body)]"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </button>
      <NotificationDropdown open={open} onClose={() => setOpen(false)} role={role} />
    </div>
  );
}
