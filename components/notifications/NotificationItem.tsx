'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useNotifications, resolveNotificationRoute, timeAgo, type Notification } from './NotificationProvider';
import { NOTIFICATION_ICONS } from './notification-config';

interface NotificationItemProps {
  notification: Notification;
  role: string;
}

export function NotificationItem({ notification, role }: NotificationItemProps) {
  const router = useRouter();
  const { markAsRead } = useNotifications();
  const isUnread = !notification.read_at;
  const cfg = NOTIFICATION_ICONS[notification.type] || NOTIFICATION_ICONS.trip_created;
  const Icon = cfg.icon;

  const handleClick = async () => {
    if (isUnread) {
      await markAsRead(notification.id);
    }
    if (notification.action_url) {
      router.push(notification.action_url);
      return;
    }
    const route = resolveNotificationRoute(notification, role);
    router.push(route);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full flex items-start gap-3 p-3 rounded-xl text-left transition-colors cursor-pointer border-none bg-transparent',
        isUnread
          ? 'bg-[rgba(0,212,255,0.04)] hover:bg-[rgba(0,212,255,0.08)]'
          : 'hover:bg-slate-50',
      )}
    >
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', cfg.bg)}>
        <Icon className={cn('w-4 h-4', cfg.color)} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-navy)] truncate">
          {notification.title}
        </p>
        <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)] line-clamp-2 mt-0.5">
          {notification.body}
        </p>
        <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] mt-1">
          {timeAgo(notification.created_at)}
        </p>
      </div>
      {isUnread && (
        <div className="w-2 h-2 rounded-full bg-[var(--color-brand-cyan)] shrink-0 mt-1.5" />
      )}
    </button>
  );
}
