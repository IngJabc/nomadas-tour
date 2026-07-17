'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Users, Plus, AlertTriangle, X } from 'lucide-react';
import { agencyApi } from '@/lib/api';
import { subscribeToReservations, subscribeToReservationPassengers, subscribeToBoardingLogs } from '@/lib/realtime/subscriptions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AgencyReservationCardSkeleton } from '@/components/ui/Skeleton';
import { Skeleton } from '@/components/ui/Skeleton';
import { AgencyReservationCard } from '@/components/agency/AgencyReservationCard';
import { pageFade, staggerContainer, staggerItem } from '@/lib/motion/variants';
import type { AgencyReservation } from '@/types';

export default function AgencyReservationsPage() {
  const [reservations, setReservations] = useState<AgencyReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await agencyApi.listReservations();
      setReservations(data);
    } catch {
      setFetchError('No se pudieron cargar las reservas. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  useEffect(() => {
    const debouncedRefetch = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(doFetch, 500);
    };

    const cleanups = [
      subscribeToReservations(debouncedRefetch),
      subscribeToReservationPassengers(debouncedRefetch),
      subscribeToBoardingLogs(debouncedRefetch),
    ];

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      cleanups.forEach((fn) => fn());
    };
  }, [doFetch]);

  const filtered = reservations.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const passengers = r.reservation_passengers ?? [];
      const matchPassenger = passengers.some(
        (p) => p.name.toLowerCase().includes(q) || p.document.toLowerCase().includes(q)
      );
      return (
        r.booker_name.toLowerCase().includes(q) ||
        r.booker_document.toLowerCase().includes(q) ||
        r.qr_code?.toLowerCase().includes(q) ||
        r.id?.toLowerCase().includes(q) ||
        matchPassenger
      );
    }
    return true;
  });

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem}>
            <div className="flex items-center justify-between mb-6">
              <div className="h-7 w-28 bg-slate-200 rounded-lg animate-pulse" />
              <div className="h-9 w-32 bg-slate-200 rounded-xl animate-pulse" />
            </div>
          </motion.div>
          <motion.div variants={staggerItem}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
              <div className="flex gap-1.5 bg-slate-100 rounded-xl h-9 px-1 shrink-0 overflow-hidden">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-7 bg-slate-200 rounded-lg animate-pulse" style={{ width: i === 1 ? 48 : i === 2 ? 96 : i === 3 ? 80 : 72 }} />
                ))}
              </div>
              <Skeleton className="h-9 flex-1 rounded-xl" />
            </div>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <motion.div key={i} variants={staggerItem}>
                <AgencyReservationCardSkeleton />
              </motion.div>
            ))}
          </div>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader
          title="Reservas"
          action={
            <Link
              href="/agency/reservations/new"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--color-brand-cyan)] text-white font-[family-name:var(--font-body)] font-semibold text-sm rounded-xl no-underline transition-all duration-200 hover:bg-[var(--color-brand-blue)]"
            >
              <Plus className="w-4 h-4" />
              Nueva reserva
            </Link>
          }
        />
      </motion.div>

      {fetchError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">{fetchError}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={doFetch}>
            Reintentar
          </Button>
        </motion.div>
      )}

      <motion.div
        className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6"
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <div className="flex items-center gap-1.5 bg-[var(--color-brand-surface)] rounded-xl h-9 px-1 border border-[rgba(0,0,0,0.06)] shrink-0 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {[
            ['', 'Todas'],
            ['confirmed', 'Confirmadas'],
            ['boarded', 'Abordados'],
            ['cancelled', 'Canceladas'],
          ].map(([s, label]) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-[family-name:var(--font-body)] font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-[var(--color-brand-cyan)] text-white'
                  : 'text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            placeholder="Reservador, pasajero, documento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 border-[1.5px] border-[#e5e7eb] rounded-xl pl-8 pr-8 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all duration-200"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-brand-muted)]" />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors duration-150"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <AnimatePresence>
          {(statusFilter || search) && (
            <motion.button
              initial={{ opacity: 0, width: 0, scaleX: 0 }}
              animate={{ opacity: 1, width: 'auto', scaleX: 1 }}
              exit={{ opacity: 0, width: 0, scaleX: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
              }}
              className="shrink-0 h-9 px-3 rounded-xl border border-[1.5px] border-[#e5e7eb] bg-white text-[var(--color-brand-muted)] hover:text-[#ef4444] hover:border-[#ef4444] transition-colors duration-150 flex items-center gap-1.5 text-xs font-[family-name:var(--font-body)] font-medium overflow-hidden origin-left"
            >
              <X className="w-3.5 h-3.5" />
              Limpiar
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="w-8 h-8" />}
          message={
            search || statusFilter
              ? 'No hay resultados con esos filtros'
              : 'Aún no hay reservas'
          }
          action={
            search || statusFilter
              ? { label: 'Limpiar filtros', onClick: () => { setSearch(''); setStatusFilter(''); } }
              : { label: 'Crear primera reserva', href: '/agency/reservations/new' }
          }
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {filtered.map((r) => (
            <motion.div key={r.id} variants={staggerItem}>
              <AgencyReservationCard reservation={r} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </main>
  );
}
