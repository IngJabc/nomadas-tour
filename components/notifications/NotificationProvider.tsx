'use client';

import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { subscribeToNotifications, type CleanupFn } from '@/lib/realtime/subscriptions';
import { NOTIFICATION_ICONS } from './notification-config';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  agency_id: string | null;
  recipient_role: string;
  read_at: string | null;
  created_at: string;
  action_url?: string | null;
  metadata?: Record<string, unknown>;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  hasCriticalUnread: boolean;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CRITICAL_TYPES = new Set(['trip_cancelled', 'trip_deleted', 'reservation_cancelled', 'passenger_cancelled']);

const NotificationContext = createContext<NotificationContextValue | null>(null);

function resolveNotificationRoute(notification: Notification, role: string): string {
  if (role === 'superadmin') {
    switch (notification.entity_type) {
      case 'trip':
        return '/admin/trips';
      case 'reservation':
        return '/admin/bookings';
      case 'passenger':
        return '/admin/bookings';
      default:
        return '/admin';
    }
  }
  switch (notification.entity_type) {
    case 'trip':
      return '/agency/trips';
    case 'reservation':
      return `/agency/reservations/${notification.entity_id}`;
    case 'passenger':
      return `/agency/reservations/${notification.entity_id}`;
    default:
      return '/agency';
  }
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch { /* ignore */ }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const cleanupRef = useRef<CleanupFn | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    try {
      if (role === 'superadmin') {
        const data = await apiFetch<Notification[]>('/admin/notifications');
        setNotifications(data);
        setUnreadCount(data.filter((n) => !n.read_at).length);
      } else if (role === 'agency') {
        const data = await apiFetch<Notification[]>('/agency/notifications');
        setNotifications(data);
        setUnreadCount(data.filter((n) => !n.read_at).length);
      }
    } catch {
      /* ignore */
    }
  }, [role]);

  const refresh = useCallback(async () => {
    await fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      const userRole = user?.user_metadata?.role as string | undefined;
      const userAgencyId = user?.user_metadata?.agency_id as string | undefined;
      setRole(userRole || null);
      setAgencyId(userAgencyId || null);
    });
  }, []);

  useEffect(() => {
    if (!role) return;

    let cancelled = false;

    const init = async () => {
      await fetchNotifications();
      if (cancelled) return;
      setLoading(false);
    };

    init();

    return () => { cancelled = true; };
  }, [role, fetchNotifications]);

  useEffect(() => {
    if (!role) return;
    if (loading) return;

    cleanupRef.current?.();

    const handleEvent = (payload: { eventType: string; notification: Record<string, any> }) => {
      if (payload.eventType === 'INSERT') {
        const notif = payload.notification as Notification;

        if (role === 'superadmin' && notif.recipient_role !== 'superadmin') {
          return;
        }

        if (
          role === 'agency' &&
          (notif.recipient_role !== 'agency' || notif.agency_id !== agencyId)
        ) {
          return;
        }

        if (seenIdsRef.current.has(notif.id)) return;
        seenIdsRef.current.add(notif.id);

        setNotifications((prev) => [notif, ...prev].slice(0, 50));
        setUnreadCount((prev) => prev + 1);

        toast.custom(
          (t) => {
            const cfg = NOTIFICATION_ICONS[notif.type] || NOTIFICATION_ICONS.trip_created;
            const Icon = cfg.icon;
            return (
              <button
                type="button"
                onClick={() => {
                  toast.dismiss(t.id);
                  const route = notif.action_url || resolveNotificationRoute(notif, role);
                  router.push(route);
                }}
                className="w-full text-left flex items-start gap-3 p-3 rounded-xl bg-white shadow-lg border border-black/5 cursor-pointer hover:scale-[1.02]"
                style={{
                  fontFamily: 'var(--font-body)',
                  maxWidth: '360px',
                  opacity: t.visible ? 1 : 0,
                  transform: `translateY(${t.visible ? '0' : '10px'}) scale(${t.visible ? '1' : '0.95'})`,
                  transition: 'opacity 200ms ease, transform 200ms ease',
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(0,212,255,0.1)' }}
                >
                  <Icon className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[13px] text-[var(--color-brand-navy)] truncate m-0">
                    {notif.title}
                  </p>
                  <p className="text-[12px] text-[var(--color-brand-muted)] line-clamp-2 mt-0.5 m-0">
                    {notif.body}
                  </p>
                </div>
              </button>
            );
          },
          { duration: 10000 },
        );
      } else if (payload.eventType === 'UPDATE') {
        const notif = payload.notification as Notification;
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, ...notif } : n))
        );
        if (notif.read_at) {
          setUnreadCount((prev) => Math.max(0, prev - 1));
        }
      }
    };

    cleanupRef.current = subscribeToNotifications(
      handleEvent,
      role,
      role === 'agency' ? agencyId ?? undefined : undefined
    );

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [role, agencyId, loading]);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    try {
      if (role === 'superadmin') {
        await apiFetch(`/admin/notifications/${id}/read`, { method: 'PATCH' });
      } else {
        await apiFetch(`/agency/notifications/${id}/read`, { method: 'PATCH' });
      }
    } catch {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: null } : n))
      );
      setUnreadCount((prev) => prev + 1);
    }
  }, [role]);

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() }))
    );
    setUnreadCount(0);

    try {
      if (role === 'superadmin') {
        await apiFetch('/admin/notifications/read-all', { method: 'PATCH' });
      } else {
        await apiFetch('/agency/notifications/read-all', { method: 'PATCH' });
      }
    } catch {
      await fetchNotifications();
    }
  }, [role, fetchNotifications]);

  const hasCriticalUnread = notifications.some(
    (n) => !n.read_at && CRITICAL_TYPES.has(n.type),
  );

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, hasCriticalUnread, loading, markAsRead, markAllAsRead, refresh }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

export { resolveNotificationRoute, timeAgo };
