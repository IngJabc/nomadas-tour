'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Calendar, CheckCircle2, Clock, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { publicReservationLinkApi } from '@/lib/api';
import { ApiError } from '@/lib/errors/api-error';
import { formatDateLong, formatTime12h } from '@/lib/timezone';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  completedPassengerCount,
  formFromPublicBody,
  formatCountdown,
  publicLinkErrorCopy,
  validatePublicLinkDraft,
  hasPublicLinkValidationErrors,
  type LinkDataForm,
  type PublicReservationLinkBody,
  type PublicLinkValidationErrors,
} from '@/lib/reservation-links';
import { buildAgencyBrandingStyle } from '@/lib/brand/utils';
import {
  filterPassengerDocument,
  filterPassengerName,
  filterPassengerPhone,
} from '@/lib/reservations/passengerFieldFilters';

const TOKEN_RE = /^[a-f0-9]{64}$/;

export default function PublicReservationLinkPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-[var(--color-page-bg)]">
          <div className="w-full max-w-sm space-y-4 px-5">
            <Skeleton className="h-5 w-3/4 rounded-lg" />
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        </div>
      }
    >
      <PublicReservationLinkContent />
    </Suspense>
  );
}

function PublicReservationLinkContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [body, setBody] = useState<PublicReservationLinkBody | null>(null);
  const [form, setForm] = useState<LinkDataForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [validationErrors, setValidationErrors] = useState<PublicLinkValidationErrors>({ passengers: {} });
  const [linkStatus, setLinkStatus] = useState<'active' | 'expired' | 'cancelled' | 'confirmed' | null>(null);
  const submittingRef = useRef(false);
  const expiredFiredRef = useRef(false);

  const applyBody = useCallback((next: PublicReservationLinkBody) => {
    const sorted = { ...next, seats: [...next.seats].sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      return numA - numB;
    }) };
    setBody(sorted);
    setForm(formFromPublicBody(sorted));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorCode(null);
    setErrorMessage(null);
    if (!TOKEN_RE.test(token)) {
      setErrorCode('LINK_NOT_FOUND');
      setErrorMessage(publicLinkErrorCopy('LINK_NOT_FOUND', 'Este enlace no existe.'));
      setLoading(false);
      return;
    }
    try {
      const data = await publicReservationLinkApi.get(token);
      applyBody(data);
      setLinkStatus('active');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429 || err.code === 'RATE_LIMIT') {
          setErrorCode('RATE_LIMIT');
          setErrorMessage('Demasiados intentos. Espera un momento e intenta de nuevo.');
        } else {
          setErrorCode(err.code);
          setErrorMessage(publicLinkErrorCopy(err.code, err.message));
          if (err.code === 'LINK_CANCELLED') setLinkStatus('cancelled');
          else if (err.code === 'LINK_EXPIRED') setLinkStatus('expired');
          else if (err.code === 'LINK_CONFIRMED') setLinkStatus('confirmed');
        }
      } else {
        setErrorCode('NETWORK');
        setErrorMessage('No se pudo cargar el enlace. Revisa tu conexión.');
      }
    } finally {
      setLoading(false);
    }
  }, [token, applyBody]);

  useEffect(() => {
    load();
  }, [load]);

  // ─── Countdown timer ─────────────────────────────────────────────
  useEffect(() => {
    if (!body?.expires_at) {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const diff = Math.max(
        0,
        Math.ceil((new Date(body.expires_at).getTime() - Date.now()) / 1000),
      );
      setRemaining(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [body?.expires_at]);

  // ─── Expired callback — fire once when countdown hits 0 ──────────
  const expiredClient = remaining !== null && remaining <= 0;
  useEffect(() => {
    if (expiredClient && !expiredFiredRef.current) {
      expiredFiredRef.current = true;
      setLinkStatus('expired');
    }
  }, [expiredClient]);

  const completed = form ? completedPassengerCount(form) : 0;
  const total = form?.passengers.length ?? 0;
  const countdownUrgent = remaining !== null && remaining <= 60;
  const isBlocked = linkStatus === 'expired' || linkStatus === 'cancelled' || linkStatus === 'confirmed';
  const formVisible = !errorCode && !isBlocked && form;

  const updateBooker = (field: 'booker_name' | 'booker_document' | 'booker_phone', value: string) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
    setSaved(false);
    setValidationErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const updatePassenger = (seatCode: string, field: 'name' | 'document' | 'phone', value: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        passengers: prev.passengers.map((p) =>
          p.seat_code === seatCode ? { ...p, [field]: value } : p,
        ),
      };
    });
    setSaved(false);
    setValidationErrors((prev) => {
      const next = { ...prev, passengers: { ...prev.passengers } };
      if (next.passengers[seatCode]) {
        next.passengers[seatCode] = { ...next.passengers[seatCode], [field]: undefined };
      }
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || submittingRef.current || isBlocked) return;

    const vErrors = validatePublicLinkDraft(form);
    setValidationErrors(vErrors);
    if (hasPublicLinkValidationErrors(vErrors)) {
      toast.error('Corrige los campos marcados antes de guardar.');
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    try {
      const next = await publicReservationLinkApi.save(token, form);
      applyBody(next);
      setSaved(true);
      setLinkStatus('active');
      toast.success('Datos guardados');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 410 || err.status === 404 || err.code === 'LINK_CANCELLED') {
          setErrorCode(err.code);
          setErrorMessage(publicLinkErrorCopy(err.code, err.message));
          setLinkStatus('cancelled');
        } else if (err.status === 429 || err.code === 'RATE_LIMIT') {
          toast.error('Demasiados intentos. Espera un momento.');
        } else {
          toast.error(err.message || 'No se pudieron guardar los datos');
        }
      } else {
        toast.error('No se pudieron guardar los datos. Revisa tu conexión.');
      }
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-[var(--color-page-bg)]">
        <div className="bg-[var(--color-brand-navy)] px-4 py-8">
          <div className="max-w-3xl mx-auto space-y-4">
            <Skeleton className="h-6 w-40 rounded-lg bg-white/10" />
            <Skeleton className="h-8 w-64 rounded-lg bg-white/10" />
            <Skeleton className="h-4 w-48 rounded-lg bg-white/10" />
          </div>
        </div>
        <div className="max-w-3xl mx-auto w-full px-4 py-8 space-y-4">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (errorCode || errorMessage) {
    const isInvalidated = linkStatus === 'cancelled';
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--color-page-bg)] px-5">
        <div className="w-full max-w-md text-center bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-8">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${isInvalidated ? 'bg-[#fef2f2]' : 'bg-slate-100'}`}>
            {isInvalidated ? (
              <AlertTriangle className="w-8 h-8 text-[#ef4444]" strokeWidth={1.75} />
            ) : (
              <Link2 className="w-8 h-8 text-[var(--color-brand-muted)]" strokeWidth={1.75} />
            )}
          </div>
          <h1 className="font-[family-name:var(--font-heading)] font-extrabold text-[24px] text-[var(--color-brand-navy)]">
            {errorMessage}
          </h1>
          {isInvalidated ? (
            <p className="mt-2 mb-6 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
              La agencia modificó la selección de asientos. Solicita un nuevo enlace a la agencia.
            </p>
          ) : (
            <p className="mt-2 mb-6 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
              Si necesitas un enlace nuevo, solicítalo a tu agencia.
            </p>
          )}
          {errorCode === 'NETWORK' || errorCode === 'RATE_LIMIT' ? (
            <Button onClick={load}>Reintentar</Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!body || !form) return null;

  const agencyBrandingStyle = buildAgencyBrandingStyle(body.agency);

  return (
    <div style={agencyBrandingStyle} className="flex-1 flex flex-col bg-[var(--color-page-bg)]">
      <header className="fixed top-0 left-0 right-0 z-40 bg-[var(--color-brand-navy)] px-4 sm:px-6 py-3">
          <div className="max-w-3xl mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            {body.agency.logo_url ? (
              <img
                src={body.agency.logo_url}
                alt={`Logo de ${body.agency.name}`}
                className="w-10 h-10 object-contain rounded-[10px] bg-white/10 p-1.5"
              />
            ) : (
              <Image src="/brand/logo-icon.svg" alt="Nómadas Tours" width={40} height={40} priority />
            )}
            <p className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-white/80">
              {body.agency.name}
            </p>
          </div>

          <h1 className="font-[family-name:var(--font-heading)] font-extrabold text-[22px] text-white">
            {body.trip.destination}
          </h1>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] text-[13px] text-white/70">
              <Calendar className="w-3.5 h-3.5" strokeWidth={1.75} />
              {formatDateLong(body.trip.departure_time)}
            </span>
            <span className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] text-[13px] text-white/70">
              <Clock className="w-3.5 h-3.5" strokeWidth={1.75} />
              {formatTime12h(body.trip.departure_time)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            {body.seats.map((code) => (
              <span
                key={code}
                className="inline-flex items-center rounded-full px-2 py-[2px] font-[family-name:var(--font-body)] font-semibold text-[10px] bg-[var(--color-cyan-bg)] text-white"
              >
                {code}
              </span>
            ))}
          </div>

          {!isBlocked && (
            <div
              className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
                countdownUrgent ? 'bg-[#fffbeb]' : 'bg-white/10'
              }`}
            >
              <Clock
                className={`w-3.5 h-3.5 ${countdownUrgent ? 'text-[#f59e0b]' : 'text-[var(--color-brand-cyan)]'}`}
                strokeWidth={1.75}
              />
              <span
                className={`font-[family-name:var(--font-body)] font-semibold text-[11px] uppercase tracking-wider ${
                  countdownUrgent ? 'text-[#92400e]' : 'text-white/70'
                }`}
              >
                Tiempo restante
              </span>
              <span
                className={`font-[family-name:var(--font-heading)] font-bold text-[12px] tabular-nums ${
                  countdownUrgent ? 'text-[#92400e]' : 'text-white'
                }`}
              >
                {remaining === null ? '--:--' : formatCountdown(remaining)}
              </span>
            </div>
          )}

          {isBlocked && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-[#fef2f2]">
              <AlertTriangle className="w-3.5 h-3.5 text-[#ef4444]" strokeWidth={1.75} />
              <span className="font-[family-name:var(--font-body)] font-semibold text-[11px] text-[#ef4444]">
                {linkStatus === 'expired' && 'Enlace expirado'}
                {linkStatus === 'cancelled' && 'Enlace cancelado'}
                {linkStatus === 'confirmed' && 'Reserva confirmada'}
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-8 mt-[200px]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="max-w-3xl mx-auto"
        >
          <h2 className="font-[family-name:var(--font-heading)] font-extrabold text-[28px] text-[var(--color-brand-navy)] text-center sm:text-left">
            {isBlocked ? 'Este enlace ya no está disponible' : 'Completa tus datos'}
          </h2>
          {!isBlocked && (
            <p className="mt-2 font-[family-name:var(--font-body)] text-[14px] text-[var(--color-brand-muted)] text-center sm:text-left">
              Tu agencia verá estos datos al instante.
            </p>
          )}
          {!isBlocked && (
            <p className="mt-2 mb-6 font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-navy)] text-center sm:text-left">
              {completed}/{total} pasajeros completados
            </p>
          )}

          <AnimatePresence>
            {isBlocked && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="mt-6 rounded-2xl bg-[var(--color-brand-surface)] border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" strokeWidth={1.75} />
                  <div>
                    <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)]">
                      {linkStatus === 'expired' && 'Este enlace ha expirado.'}
                      {linkStatus === 'cancelled' && 'Este enlace ya no es válido.'}
                      {linkStatus === 'confirmed' && 'Esta reserva ya fue confirmada.'}
                    </p>
                    <p className="mt-1 font-[family-name:var(--font-body)] text-[13px] text-[var(--color-brand-muted)]">
                      Solicita un nuevo enlace a tu agencia.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {saved && !isBlocked && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-[#ecfdf5]"
              >
                <CheckCircle2 className="w-5 h-5 text-[#059669] shrink-0 mt-0.5" strokeWidth={1.75} />
                <div>
                  <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[#047857]">
                    Datos guardados
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {formVisible && (
            <form onSubmit={handleSave} className="space-y-6">
              <section className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6">
                <h3 className="border-l-4 border-[var(--color-brand-cyan)] pl-3 mb-4 font-[family-name:var(--font-heading)] font-bold text-[20px] text-[var(--color-brand-navy)]">
                  Datos del Reservante
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Nombre"
                    value={form.booker_name}
                    onChange={(e) => updateBooker('booker_name', filterPassengerName(e.target.value))}
                    placeholder="Nombre completo"
                    autoComplete="name"
                    enterKeyHint="next"
                    error={validationErrors.booker_name}
                  />
                  <Input
                    label="Documento"
                    value={form.booker_document}
                    onChange={(e) =>
                      updateBooker('booker_document', filterPassengerDocument(e.target.value))
                    }
                    placeholder="7 u 8 dígitos"
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="next"
                    maxLength={8}
                    error={validationErrors.booker_document}
                  />
                </div>
                <div className="mt-4">
                  <Input
                    label="Teléfono"
                    value={form.booker_phone}
                    onChange={(e) =>
                      updateBooker('booker_phone', filterPassengerPhone(e.target.value))
                    }
                    placeholder="04xx-xxxxxxx"
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="next"
                    maxLength={13}
                    error={validationErrors.booker_phone}
                  />
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="border-l-4 border-[var(--color-brand-cyan)] pl-3 font-[family-name:var(--font-heading)] font-bold text-[20px] text-[var(--color-brand-navy)]">
                  Datos de Pasajeros ({form.passengers.length})
                </h3>
                {form.passengers.map((passenger, i) => {
                  const pErrors = validationErrors.passengers[passenger.seat_code];
                  return (
                    <div
                      key={passenger.seat_code}
                      className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6"
                    >
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 rounded-lg bg-[var(--color-brand-cyan)] text-white flex items-center justify-center text-xs font-bold font-[family-name:var(--font-body)]">
                          {passenger.seat_code}
                        </div>
                        <span className="font-[family-name:var(--font-body)] text-[17px] font-semibold text-[var(--color-brand-navy)]">
                          Asiento {passenger.seat_code}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Input
                          label="Nombre"
                          value={passenger.name}
                          onChange={(e) =>
                            updatePassenger(
                              passenger.seat_code,
                              'name',
                              filterPassengerName(e.target.value),
                            )
                          }
                          placeholder="Nombre completo"
                          autoComplete="name"
                          enterKeyHint="next"
                          error={pErrors?.name}
                        />
                        <Input
                          label="Documento"
                          value={passenger.document}
                          onChange={(e) =>
                            updatePassenger(
                              passenger.seat_code,
                              'document',
                              filterPassengerDocument(e.target.value),
                            )
                          }
                          placeholder="7 u 8 dígitos"
                          inputMode="numeric"
                          autoComplete="off"
                          enterKeyHint="next"
                          maxLength={8}
                          error={pErrors?.document}
                        />
                        <Input
                          label="Teléfono"
                          value={passenger.phone}
                          onChange={(e) =>
                            updatePassenger(
                              passenger.seat_code,
                              'phone',
                              filterPassengerPhone(e.target.value),
                            )
                          }
                          placeholder="04xx-xxxxxxx"
                          inputMode="tel"
                          autoComplete="tel"
                          enterKeyHint={i === form.passengers.length - 1 ? 'done' : 'next'}
                          maxLength={13}
                          error={pErrors?.phone}
                        />
                      </div>
                    </div>
                  );
                })}
              </section>

              <div className="flex sm:justify-end pt-2">
                <Button type="submit" size="lg" loading={saving} className="w-full sm:w-auto">
                  Guardar
                </Button>
              </div>
            </form>
          )}
        </motion.div>
      </main>
    </div>
  );
}
