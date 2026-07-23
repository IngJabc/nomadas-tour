'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCheck } from 'lucide-react';
import { useNotifications } from './NotificationProvider';
import { NotificationItem } from './NotificationItem';
import { NotificationSkeleton } from './NotificationSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';

interface NotificationDropdownProps {
  open: boolean;
  onClose: () => void;
  role: string;
}

export function NotificationDropdown({ open, onClose, role }: NotificationDropdownProps) {
  const { notifications, unreadCount, loading, markAllAsRead } = useNotifications();
  const [markingAll, setMarkingAll] = useState(false);

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    await markAllAsRead();
    setMarkingAll(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 md:hidden"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            className="fixed left-1/2 -translate-x-1/2 top-16 w-[calc(100vw-32px)] max-w-[380px] max-h-[480px] bg-white rounded-2xl shadow-xl border border-slate-200/60 flex flex-col z-50 overflow-hidden md:absolute md:left-auto md:translate-x-0 md:top-full md:right-0 md:mt-2 md:w-[380px]"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0">
              <h3 className="font-[family-name:var(--font-heading)] font-bold text-[15px] text-[var(--color-brand-navy)]">
                Notificaciones
              </h3>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllRead}
                  loading={markingAll}
                  className="text-[11px] px-2 py-1"
                >
                  <CheckCheck className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Marcar todo leído
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <NotificationSkeleton />
              ) : notifications.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={<CheckCheck className="w-8 h-8" />}
                    message="Sin notificaciones"
                  />
                </div>
              ) : (
                <div className="px-2 pb-2">
                  {notifications.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      notification={notif}
                      role={role}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
