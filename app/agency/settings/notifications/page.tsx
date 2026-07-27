'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { Bell, Loader2 } from 'lucide-react';
import {
  agencyApi,
  type NotificationPreferenceCategory,
  type NotificationPreferencesResponse,
} from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { pageFade, staggerContainer, staggerItem } from '@/lib/motion/variants';

type PreferenceKey = keyof NotificationPreferencesResponse['preferences'];

function PreferenceToggle({
  enabled,
  loading,
  onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-disabled={loading}
      disabled={loading}
      onClick={onToggle}
      className={[
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer',
        enabled ? 'bg-[var(--color-brand-cyan)]' : 'bg-[#e2e8f0]',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200',
          enabled ? 'translate-x-6' : 'translate-x-1',
        ].join(' ')}
      />
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" strokeWidth={2} />
        </span>
      )}
    </button>
  );
}

function CategoryCard({
  category,
  enabled,
  saving,
  onToggle,
}: {
  category: NotificationPreferenceCategory;
  enabled: boolean;
  saving: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex-1 min-w-0">
        <h3 className="font-[family-name:var(--font-body)] font-semibold text-[17px] text-[var(--color-brand-navy)] mb-1">
          {category.label}
        </h3>
        <p className="font-[family-name:var(--font-body)] font-normal text-[13px] text-[var(--color-brand-muted)]">
          {category.description}
        </p>
        <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)] mt-2">
          Aplica al panel y al correo de la agencia.
        </p>
      </div>
      <PreferenceToggle enabled={enabled} loading={saving} onToggle={onToggle} />
    </Card>
  );
}

export default function AgencyNotificationPreferencesPage() {
  const [data, setData] = useState<NotificationPreferencesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<PreferenceKey | null>(null);
  const inFlightRef = useRef(false);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await agencyApi.getNotificationPreferences();
      setData(response);
    } catch {
      setError('No se pudieron cargar las preferencias. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const handleToggle = useCallback(
    async (key: PreferenceKey, nextValue: boolean) => {
      if (!data || inFlightRef.current) return;

      const category = data.categories.find((item) => item.key === key);
      if (!category || category.locked) return;

      const previous = data;
      inFlightRef.current = true;
      setSavingKey(key);

      setData({
        ...data,
        preferences: { ...data.preferences, [key]: nextValue },
        categories: data.categories.map((item) =>
          item.key === key
            ? {
                ...item,
                channels: { in_app: nextValue, email: nextValue },
              }
            : item,
        ),
      });

      try {
        const updated = await agencyApi.updateNotificationPreferences({
          [key]: nextValue,
        });
        setData(updated);
        toast.success('Preferencia actualizada');
      } catch {
        setData(previous);
        toast.error('No se pudo guardar la preferencia');
      } finally {
        inFlightRef.current = false;
        setSavingKey(null);
      }
    },
    [data],
  );

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader title="Preferencias de notificaciones" />

        <div className="mb-6">
          <SectionTitle>Configuración de alertas</SectionTitle>
          <p className="font-[family-name:var(--font-body)] font-normal text-[14px] text-[var(--color-brand-muted)] mt-3 max-w-3xl">
            Controla qué notificaciones de viajes recibe tu agencia en el panel y por
            correo electrónico.
          </p>
        </div>

        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        )}

        {!loading && error && (
          <Card className="flex flex-col items-start gap-4">
            <div className="flex items-center gap-3 text-[#ef4444]">
              <Bell className="w-5 h-5 shrink-0" strokeWidth={1.75} />
              <p className="font-[family-name:var(--font-body)] text-sm">{error}</p>
            </div>
            <button
              type="button"
              onClick={loadPreferences}
              className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-cyan)] bg-transparent border-none cursor-pointer"
            >
              Reintentar
            </button>
          </Card>
        )}

        {!loading && !error && data && (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-4"
          >
            {data.categories
              .filter((category) => !category.locked)
              .map((category) => {
              const key = category.key as PreferenceKey;
              return (
                <motion.div key={category.key} variants={staggerItem}>
                  <CategoryCard
                    category={category}
                    enabled={data.preferences[key]}
                    saving={savingKey === key}
                    onToggle={() => handleToggle(key, !data.preferences[key])}
                  />
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </motion.div>
    </main>
  );
}
