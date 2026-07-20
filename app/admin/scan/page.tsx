'use client';

import toast from 'react-hot-toast';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Html5Qrcode } from 'html5-qrcode';
import { formatDateTimeShort } from '@/lib/timezone';
import type { Html5QrcodeResult } from 'html5-qrcode';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, RotateCcw, CheckCircle, XCircle, AlertCircle, Search, ArrowRight } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Spinner } from '@/components/ui/Spinner';

type BookingResult = {
  id: string;
  customer_name: string;
  passenger_cedula: string;
  qr_code: string;
  status: string;
  seat_code: string;
  trip: {
    id: string;
    departure_time: string;
    status: string;
    route: { origin: string; destination: string } | null;
  } | null;
};

const STATUS_BADGE: Record<string, { label: string; variant: 'confirmed' | 'boarded' | 'cancelled' }> = {
  confirmed: { label: 'Confirmada', variant: 'confirmed' },
  cancelled: { label: 'Cancelada', variant: 'cancelled' },
  boarded: { label: 'Abordado', variant: 'boarded' },
};

export default function ScanPage() {
  const router = useRouter();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanSuccessRef = useRef<((decodedText: string, result: Html5QrcodeResult) => void) | null>(null!);
  const [scanning, setScanning] = useState(false);
  const [initializingCamera, setInitializingCamera] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFacingError, setCameraFacingError] = useState(false);
  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [loadingBooking, setLoadingBooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [manualQrValue, setManualQrValue] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const lookupRef = useRef(false);
  const boardingRef = useRef(false);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch { /* ignore */ }
      scannerRef.current = null;
    }
    setScanning(false);
    setCameraReady(false);
    setInitializingCamera(false);
    setCameraFacingError(false);
  }, []);

  const lookupByQR = useCallback(async (qrCode: string) => {
    setLookupError(null);
    setLoadingBooking(true);
    setSuccessMsg(null);

    try {
      const data = await adminApi.listReservations({ status: 'confirmed', search: qrCode, limit: 100 });
      const reservations = data.data || [];
      const found = reservations.find((r: any) => r.qr_code === qrCode);
      if (!found) {
        setLookupError('Reserva no encontrada');
        setBooking(null);
        return;
      }
      setBooking(found);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Error al buscar reserva');
      setBooking(null);
    } finally {
      setLoadingBooking(false);
    }
  }, []);

  const onScanSuccess = useCallback(async (decodedText: string, _result: Html5QrcodeResult) => {
    await stopCamera();
    await lookupByQR(decodedText);
  }, [stopCamera, lookupByQR]);

  useEffect(() => {
    onScanSuccessRef.current = onScanSuccess;
  }, [onScanSuccess]);

  useEffect(() => {
    if (!scanning) return;

    let cancelled = false;
    setInitializingCamera(true);
    setCameraReady(false);
    setCameraError(null);

    const startWithFacing = async (facingMode: string): Promise<boolean> => {
      if (cancelled) return false;
      try {
        const scanner = new Html5Qrcode('qr-reader-container');
        const scanHandler = (decodedText: string, result: Html5QrcodeResult) => {
          onScanSuccessRef.current?.(decodedText, result);
        };
        await scanner.start(
          { facingMode },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          scanHandler,
          () => {},
        );
        scannerRef.current = scanner;
        if (!cancelled) {
          setCameraReady(true);
          setInitializingCamera(false);
          return true;
        }
        return false;
      } catch {
        setInitializingCamera(false);
        return false;
      }
    };

    (async () => {
      const envOk = await startWithFacing('environment');
      if (cancelled) return;
      if (!envOk) {
        setCameraFacingError(true);
        const userOk = await startWithFacing('user');
        if (cancelled) return;
        if (!userOk) {
          setCameraError('No se pudo acceder a la cámara trasera ni frontal. Verifica los permisos o conecta una cámara externa.');
          setCameraReady(false);
          setInitializingCamera(false);
          setScanning(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
      setCameraReady(false);
      setInitializingCamera(false);
    };
  }, [scanning]);

  const handleStartCamera = () => {
    setCameraError(null);
    setBooking(null);
    setLookupError(null);
    setSuccessMsg(null);
    setShowConfetti(false);
    setShowManualInput(false);
    setManualQrValue('');
    setScanning(true);
  };

  const handleManualLookup = async () => {
    if (lookupRef.current) return;
    const qr = manualQrValue.trim();
    if (!qr) return;
    lookupRef.current = true;
    try {
      await stopCamera();
      await lookupByQR(qr);
    } finally {
      lookupRef.current = false;
    }
  };

  const handleConfirmBoarding = async () => {
    if (boardingRef.current) return;
    if (!booking || !booking.trip) return;
    boardingRef.current = true;
    setUpdating(true);
    setSuccessMsg(null);
    try {
      await adminApi.listReservations({ status: 'confirmed' });
      await (await import('@/lib/supabase/client')).createClient()
        .from('reservations')
        .update({ status: 'boarded' })
        .eq('id', booking.id);
      await (await import('@/lib/supabase/client')).createClient()
        .from('seats')
        .update({ status: 'blocked', updated_at: new Date().toISOString() })
        .eq('trip_id', booking.trip?.id)
        .eq('seat_code', booking.seat_code);
      setSuccessMsg('Abordaje confirmado correctamente');
      toast.success('Abordaje confirmado correctamente');
      setShowConfetti(true);
      setBooking((prev) => prev ? { ...prev, status: 'boarded' } : null);
      setTimeout(() => setShowConfetti(false), 2500);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Error al confirmar abordaje');
      toast.error(err instanceof Error ? err.message : 'Error al confirmar abordaje');
    } finally {
      boardingRef.current = false;
      setUpdating(false);
    }
  };

  const handleReset = () => {
    setBooking(null);
    setLookupError(null);
    setSuccessMsg(null);
    setCameraError(null);
    setShowConfetti(false);
    setShowManualInput(false);
    setManualQrValue('');
    setScanning(true);
  };

  const handleRetryCamera = () => {
    setCameraError(null);
    setCameraFacingError(false);
    setShowManualInput(false);
    setScanning(true);
  };

  const badge = booking ? STATUS_BADGE[booking.status] : null;

  const AlreadyBoardedBanner = () => (
    <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-center gap-2">
      <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
      <span className="font-[family-name:var(--font-body)] font-semibold text-sm text-blue-700">
        Este pasajero ya realizó el abordaje anteriormente
      </span>
    </div>
  );

  const SuccessAnimation = () => (
    <AnimatePresence>
      {showConfetti && (
        <motion.div
          className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="w-24 h-24 rounded-full bg-emerald-500 flex items-center justify-center shadow-2xl"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.2, 1], rotate: [0, 10, -10, 0] }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <CheckCircle size={44} stroke="white" strokeWidth={3} />
          </motion.div>
          {Array.from({ length: 12 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-3 h-3 rounded-full"
              style={{ background: ['var(--color-brand-cyan)', '#10b981', '#f59e0b', 'var(--color-brand-blue)'][i % 4] }}
              initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
              animate={{
                x: Math.cos((i * 30 * Math.PI) / 180) * 140,
                y: Math.sin((i * 30 * Math.PI) / 180) * 140,
                scale: 0,
                opacity: 0,
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <SuccessAnimation />

      <PageHeader
        title="Escáner de abordaje"
      />
      <p className="font-[family-name:var(--font-body)] font-normal text-[13px] text-[var(--color-brand-muted)] mb-6 -mt-4">
        Escanea el código QR del pasajero en la puerta del autobús para confirmar su abordaje
      </p>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <SectionTitle>{scanning ? 'Enfoca el código QR del pasajero' : 'Escáner'}</SectionTitle>
            {cameraReady && (
              <span className="ml-auto inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] font-semibold text-[10px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Cámara activa
              </span>
            )}
            {cameraFacingError && cameraReady && (
              <span className="ml-auto inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] font-semibold text-[10px] text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                Cámara frontal
              </span>
            )}
          </div>

          {!scanning && !booking && !lookupError && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-20 h-20 bg-[var(--color-page-bg)] rounded-2xl flex items-center justify-center">
                <Camera className="w-10 h-10 text-[var(--color-brand-muted)]" />
              </div>
              <Button onClick={handleStartCamera} size="lg">
                Iniciar escáner
              </Button>
              <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)] text-center max-w-xs">
                También puedes hacer clic en un pasajero desde la lista para ver su detalle
              </p>
            </div>
          )}

          {scanning && !cameraReady && !cameraError && (
            <div className="flex flex-col items-center gap-4 py-12">
              <Spinner size={40} text="Iniciando cámara..." />
            </div>
          )}

          {cameraError && (
            <div className="py-6 text-center">
              <div className="w-12 h-12 bg-[#fef2f2] rounded-2xl flex items-center justify-center mx-auto mb-3">
                <XCircle className="w-6 h-6 text-[#ef4444]" />
              </div>
              <p className="font-[family-name:var(--font-body)] font-normal text-sm text-[#ef4444] mb-3">{cameraError}</p>
              <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)] mb-4">
                También puedes buscar al pasajero manualmente desde la lista de pasajeros
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <Button onClick={handleRetryCamera} size="sm">Reintentar cámara</Button>
                <Button variant="secondary" size="sm" onClick={() => setShowManualInput(true)}>
                  <Search className="w-4 h-4" />
                  Ingresar código manual
                </Button>
                <Button variant="secondary" size="sm" onClick={() => router.push('/admin/bookings')}>
                  Ir a pasajeros
                </Button>
              </div>

              {showManualInput && (
                <div className="mt-5 max-w-xs mx-auto">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Input
                        label="Código QR"
                        type="text"
                        value={manualQrValue}
                        onChange={(e) => setManualQrValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleManualLookup()}
                        placeholder="Ingresa el código QR..."
                      />
                    </div>
                    <Button
                      onClick={handleManualLookup}
                      disabled={!manualQrValue.trim() || loadingBooking}
                      loading={loadingBooking}
                      size="md"
                    >
                      Buscar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {scanning && !cameraError && (
            <div>
              <div className="relative w-full max-w-sm mx-auto">
                <div id="qr-reader-container" className="w-full rounded-xl overflow-hidden" />
                {cameraReady && (
                  <div className="absolute inset-x-0 top-0 h-full pointer-events-none overflow-hidden rounded-xl">
                    <motion.div
                      className="absolute left-[10%] right-[10%] h-[2px] bg-[var(--color-brand-cyan)] shadow-[0_0_8px_rgba(0,212,255,0.7)]"
                      animate={{ top: ['5%', '95%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    />
                    <div className="absolute inset-0 border-[3px] border-[var(--color-brand-cyan)]/30 rounded-xl" />
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-[var(--color-brand-cyan)] rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-[var(--color-brand-cyan)] rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-[var(--color-brand-cyan)] rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-[var(--color-brand-cyan)] rounded-br-lg" />
                  </div>
                )}
              </div>
              {cameraReady && (
                <div className="flex justify-center mt-4">
                  <Button variant="destructive" size="sm" onClick={stopCamera}>
                    Detener cámara
                  </Button>
                </div>
              )}
            </div>
          )}

          {loadingBooking && (
            <div className="flex items-center justify-center gap-3 py-8">
              <Spinner size={20} text="Buscando reserva..." />
            </div>
          )}

          {lookupError && !loadingBooking && (
            <div className="py-6 text-center">
              <div className="w-12 h-12 bg-[#fef2f2] rounded-2xl flex items-center justify-center mx-auto mb-3">
                <XCircle className="w-6 h-6 text-[#ef4444]" />
              </div>
              <p className="font-[family-name:var(--font-body)] font-normal text-sm text-[#ef4444] mb-1">{lookupError}</p>
              <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)] mb-4">
                Verifica que el código QR sea válido
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <Button onClick={handleReset}>Escanear otro</Button>
                <Button variant="secondary" onClick={() => { setLookupError(null); setShowManualInput(true); }}>
                  Ingresar código manual
                </Button>
              </div>

              {showManualInput && (
                <div className="mt-5 max-w-xs mx-auto">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Input
                        label="Código QR"
                        type="text"
                        value={manualQrValue}
                        onChange={(e) => setManualQrValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleManualLookup()}
                        placeholder="Ingresa el código QR..."
                      />
                    </div>
                    <Button
                      onClick={handleManualLookup}
                      disabled={!manualQrValue.trim() || loadingBooking}
                      loading={loadingBooking}
                      size="md"
                    >
                      Buscar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {booking && !loadingBooking && (
          <Card borderLeft borderColor="var(--color-brand-cyan)">
            <div className="flex items-center justify-between gap-3 mb-4">
              <SectionTitle>Pasajero encontrado</SectionTitle>
              {badge && (
                <Badge variant={badge.variant} size="md">{badge.label}</Badge>
              )}
            </div>

            {successMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                <span className="font-[family-name:var(--font-body)] font-semibold text-sm text-emerald-700">{successMsg}</span>
              </div>
            )}

            {booking.status === 'boarded' && !successMsg && <AlreadyBoardedBanner />}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block font-[family-name:var(--font-body)] font-medium text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider mb-1">Nombre</label>
                <p className="font-[family-name:var(--font-body)] font-semibold text-[15px] text-[var(--color-brand-navy)]">{booking.customer_name}</p>
              </div>
              <div>
                <label className="block font-[family-name:var(--font-body)] font-medium text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider mb-1">Cédula</label>
                <p className="font-[family-name:var(--font-body)] font-semibold text-[15px] text-[var(--color-brand-navy)]">{booking.passenger_cedula ?? '—'}</p>
              </div>
              <div>
                <label className="block font-[family-name:var(--font-body)] font-medium text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider mb-1">Asiento</label>
                <p className="font-[family-name:var(--font-body)] font-bold text-[18px] text-[var(--color-brand-navy)] bg-slate-100 inline-block px-3 py-1 rounded-lg">{booking.seat_code ?? '—'}</p>
              </div>
              <div>
                <label className="block font-[family-name:var(--font-body)] font-medium text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider mb-1">Ruta</label>
                <p className="font-[family-name:var(--font-body)] font-normal text-[14px] text-[var(--color-brand-navy)]">
                  {booking.trip?.route?.origin ?? '—'} → {booking.trip?.route?.destination ?? '—'}
                </p>
                <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)]">
                  {booking.trip?.departure_time
                    ? formatDateTimeShort(booking.trip.departure_time)
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {booking.status !== 'boarded' ? (
                <Button
                  onClick={handleConfirmBoarding}
                  loading={updating}
                  size="lg"
                >
                  <CheckCircle className="w-4 h-4" />
                  Confirmar abordaje
                </Button>
              ) : (
                <div className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-50 text-emerald-700 font-[family-name:var(--font-body)] font-semibold text-sm">
                  <CheckCircle className="w-4 h-4" />
                  Abordaje completado
                </div>
              )}
              <Button
                variant="secondary"
                size="lg"
                onClick={handleReset}
                disabled={updating}
              >
                <RotateCcw className="w-4 h-4" />
                Escanear otro
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => router.push(`/admin/bookings/${booking.id}`)}
              >
                <ArrowRight className="w-4 h-4" />
                Ver detalle
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
