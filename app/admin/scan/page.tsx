'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Html5Qrcode } from 'html5-qrcode';
import type { Html5QrcodeResult } from 'html5-qrcode';
import { AnimatePresence, motion } from 'framer-motion';

type BookingResult = {
  id: string;
  passenger_name: string;
  passenger_email: string;
  passenger_cedula: string;
  qr_code: string;
  status: string;
  seat: { seat_code: string } | null;
  trip: {
    departure_at: string;
    status: string;
    route: { origin: string; destination: string } | null;
  } | null;
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmada', cls: 'bg-emerald-50 text-emerald-600' },
  cancelled: { label: 'Cancelada', cls: 'bg-red-50 text-red-500' },
  boarded: { label: 'Abordado', cls: 'bg-blue-50 text-blue-600' },
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

  const onScanSuccess = useCallback(async (decodedText: string, _result: Html5QrcodeResult) => {
    await stopCamera();
    setLookupError(null);
    setLoadingBooking(true);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/admin/bookings/by-qr?qr=${encodeURIComponent(decodedText)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? 'Reserva no encontrada');
      }
      const data: BookingResult = await res.json();
      setBooking(data);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Error al buscar reserva');
      setBooking(null);
    } finally {
      setLoadingBooking(false);
    }
  }, [stopCamera]);

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

        // Only assign ref after successful start so cleanup never calls stop() on a failed scanner
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
          setCameraError(
            'No se pudo acceder a la cámara trasera ni frontal. '
            + 'Verifica los permisos o conecta una cámara externa.'
          );
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
    const qr = manualQrValue.trim();
    if (!qr) return;
    setLookupError(null);
    setLoadingBooking(true);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/admin/bookings/by-qr?qr=${encodeURIComponent(qr)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? 'Reserva no encontrada');
      }
      const data: BookingResult = await res.json();
      setBooking(data);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Error al buscar reserva');
      setBooking(null);
    } finally {
      setLoadingBooking(false);
    }
  };

  const handleConfirmBoarding = async () => {
    if (!booking) return;
    setUpdating(true);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'boarded' }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? 'Error al confirmar');
      }
      setSuccessMsg('Abordaje confirmado correctamente');
      setShowConfetti(true);
      setBooking((prev) => prev ? { ...prev, status: 'boarded' } : null);
      setTimeout(() => setShowConfetti(false), 2500);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Error al confirmar abordaje');
    } finally {
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
      <svg className="w-5 h-5 text-blue-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="font-['Poppins',sans-serif] font-semibold text-sm text-blue-700">
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
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </motion.div>
          {Array.from({ length: 12 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-3 h-3 rounded-full"
              style={{
                background: ['#00D4FF', '#10b981', '#f59e0b', '#0080FF'][i % 4],
              }}
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

      {/* Breadcrumb */}
      <div className="mb-6">
        <p className="font-['Poppins',sans-serif] font-normal text-xs text-brand-muted">
          <Link href="/admin" className="text-brand-cyan no-underline hover:underline">Admin</Link>
          {' / Escanear QR'}
        </p>
        <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[22px] sm:text-2xl text-brand-navy mt-1">
          Escáner de abordaje
        </h1>
        <p className="font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted mt-1">
          Escanea el código QR del pasajero en la puerta del autobús para confirmar su abordaje
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Scanner section */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
            <h2 className="font-['Montserrat',sans-serif] font-bold text-base text-brand-navy">
              {scanning ? 'Enfoca el código QR del pasajero' : 'Escáner'}
            </h2>
            {cameraReady && (
              <span className="ml-auto inline-flex items-center gap-1.5 font-['Poppins',sans-serif] font-semibold text-[10px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Cámara activa
              </span>
            )}
            {cameraFacingError && cameraReady && (
              <span className="ml-auto inline-flex items-center gap-1.5 font-['Poppins',sans-serif] font-semibold text-[10px] text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                Cámara frontal
              </span>
            )}
          </div>

          {/* Initial state: no scanning, no booking, no error */}
          {!scanning && !booking && !lookupError && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center">
                <svg className="w-10 h-10 text-brand-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <button
                type="button"
                onClick={handleStartCamera}
                className="px-6 py-3 rounded-xl bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm border-none cursor-pointer hover:bg-brand-blue transition-colors"
              >
                Iniciar escáner
              </button>
              <p className="font-['Poppins',sans-serif] font-normal text-[12px] text-brand-muted text-center max-w-xs">
                También puedes hacer clic en un pasajero desde la lista para ver su detalle
              </p>
            </div>
          )}

          {/* Camera initializing spinner */}
          {scanning && !cameraReady && !cameraError && (
            <div className="flex flex-col items-center gap-4 py-12">
              <span className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-cyan" />
              <span className="font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">
                Iniciando cámara...
              </span>
            </div>
          )}

          {/* Camera error */}
          {cameraError && (
            <div className="py-6 text-center">
              <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-['Poppins',sans-serif] font-normal text-sm text-red-500 mb-3">{cameraError}</p>
              <p className="font-['Poppins',sans-serif] font-normal text-[12px] text-brand-muted mb-4">
                También puedes buscar al pasajero manualmente desde la lista de pasajeros
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <button
                  type="button"
                  onClick={handleRetryCamera}
                  className="px-4 py-2 rounded-xl bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-xs border-none cursor-pointer hover:bg-brand-blue transition-colors"
                >
                  Reintentar cámara
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualInput(true)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-brand-navy font-['Poppins',sans-serif] font-semibold text-xs border-none cursor-pointer hover:bg-slate-200 transition-colors"
                >
                  Ingresar código manual
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/admin/bookings')}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-brand-navy font-['Poppins',sans-serif] font-semibold text-xs border-none cursor-pointer hover:bg-slate-200 transition-colors"
                >
                  Ir a pasajeros
                </button>
              </div>

              {showManualInput && (
                <div className="mt-5 max-w-xs mx-auto">
                  <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-2 text-left">
                    Código QR
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualQrValue}
                      onChange={(e) => setManualQrValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualLookup()}
                      placeholder="Ingresa el código QR..."
                      className="flex-1 px-4 py-2.5 rounded-xl border-[1.5px] border-slate-200 font-['Poppins',sans-serif] text-sm text-brand-navy outline-none focus:border-brand-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
                    />
                    <button
                      type="button"
                      onClick={handleManualLookup}
                      disabled={!manualQrValue.trim() || loadingBooking}
                      className="px-4 py-2 rounded-xl bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-xs border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-blue transition-colors"
                    >
                      {loadingBooking ? (
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white inline-block" />
                      ) : 'Buscar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Scanner view — container always rendered when scanning so html5-qrcode finds it before start() */}
          {scanning && !cameraError && (
            <div>
              <div className="relative w-full max-w-sm mx-auto">
                <div
                  id="qr-reader-container"
                  className="w-full rounded-xl overflow-hidden"
                />
                {/* Scanning line overlay — only when camera is streaming */}
                {cameraReady && (
                  <div className="absolute inset-x-0 top-0 h-full pointer-events-none overflow-hidden rounded-xl">
                    <motion.div
                      className="absolute left-[10%] right-[10%] h-[2px] bg-brand-cyan shadow-[0_0_8px_rgba(0,212,255,0.7)]"
                      animate={{ top: ['5%', '95%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    />
                    <div className="absolute inset-0 border-[3px] border-brand-cyan/30 rounded-xl" />
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-brand-cyan rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-brand-cyan rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-brand-cyan rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-brand-cyan rounded-br-lg" />
                  </div>
                )}
              </div>
              {cameraReady && (
                <div className="flex justify-center mt-4">
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-4 py-2 rounded-xl bg-red-50 text-red-500 font-['Poppins',sans-serif] font-semibold text-xs border-none cursor-pointer hover:bg-red-100 transition-colors"
                  >
                    Detener cámara
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Loading booking */}
          {loadingBooking && (
            <div className="flex items-center justify-center gap-3 py-8">
              <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-brand-cyan" />
              <span className="font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">
                Buscando reserva...
              </span>
            </div>
          )}

          {/* Lookup error */}
          {lookupError && !loadingBooking && (
            <div className="py-6 text-center">
              <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-['Poppins',sans-serif] font-normal text-sm text-red-500 mb-1">{lookupError}</p>
              <p className="font-['Poppins',sans-serif] font-normal text-[12px] text-brand-muted mb-4">
                Verifica que el código QR sea válido
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-5 py-2.5 rounded-xl bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm border-none cursor-pointer hover:bg-brand-blue transition-colors"
                >
                  Escanear otro
                </button>
                <button
                  type="button"
                  onClick={() => { setLookupError(null); setShowManualInput(true); }}
                  className="px-5 py-2.5 rounded-xl bg-slate-100 text-brand-navy font-['Poppins',sans-serif] font-semibold text-sm border-none cursor-pointer hover:bg-slate-200 transition-colors"
                >
                  Ingresar código manual
                </button>
              </div>

              {showManualInput && (
                <div className="mt-5 max-w-xs mx-auto">
                  <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-2 text-left">
                    Código QR
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualQrValue}
                      onChange={(e) => setManualQrValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualLookup()}
                      placeholder="Ingresa el código QR..."
                      className="flex-1 px-4 py-2.5 rounded-xl border-[1.5px] border-slate-200 font-['Poppins',sans-serif] text-sm text-brand-navy outline-none focus:border-brand-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
                    />
                    <button
                      type="button"
                      onClick={handleManualLookup}
                      disabled={!manualQrValue.trim() || loadingBooking}
                      className="px-4 py-2 rounded-xl bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-xs border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-blue transition-colors"
                    >
                      {loadingBooking ? (
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white inline-block" />
                      ) : 'Buscar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Result section */}
        {booking && !loadingBooking && (
          <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)] border-l-4 border-l-brand-cyan">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
                <h2 className="font-['Montserrat',sans-serif] font-bold text-base text-brand-navy">
                  Pasajero encontrado
                </h2>
              </div>
              {badge && (
                <span className={`shrink-0 inline-block font-['Poppins',sans-serif] font-semibold text-[11px] px-3 py-1 rounded-full ${badge.cls}`}>
                  {badge.label}
                </span>
              )}
            </div>

            {successMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-['Poppins',sans-serif] font-semibold text-sm text-emerald-700">
                  {successMsg}
                </span>
              </div>
            )}

            {booking.status === 'boarded' && !successMsg && <AlreadyBoardedBanner />}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Nombre
                </label>
                <p className="font-['Poppins',sans-serif] font-semibold text-[15px] text-brand-navy">
                  {booking.passenger_name}
                </p>
              </div>
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Cédula
                </label>
                <p className="font-['Poppins',sans-serif] font-semibold text-[15px] text-brand-navy">
                  {booking.passenger_cedula ?? '—'}
                </p>
              </div>
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Asiento
                </label>
                <p className="font-['Poppins',sans-serif] font-bold text-[18px] text-brand-navy bg-slate-100 inline-block px-3 py-1 rounded-lg">
                  {booking.seat?.seat_code ?? '—'}
                </p>
              </div>
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Ruta
                </label>
                <p className="font-['Poppins',sans-serif] font-normal text-[14px] text-brand-navy">
                  {booking.trip?.route?.origin ?? '—'} → {booking.trip?.route?.destination ?? '—'}
                </p>
                <p className="font-['Poppins',sans-serif] font-normal text-[12px] text-brand-muted">
                  {booking.trip?.departure_at
                    ? format(new Date(booking.trip.departure_at), 'dd/MM/yyyy HH:mm')
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {booking.status !== 'boarded' ? (
                <button
                  type="button"
                  onClick={handleConfirmBoarding}
                  disabled={updating}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 text-white font-['Poppins',sans-serif] font-semibold text-sm border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
                >
                  {updating ? (
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  Confirmar abordaje
                </button>
              ) : (
                <div className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-50 text-emerald-700 font-['Poppins',sans-serif] font-semibold text-sm">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Abordaje completado
                </div>
              )}
              <button
                type="button"
                onClick={handleReset}
                disabled={updating}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-100 text-brand-navy font-['Poppins',sans-serif] font-semibold text-sm border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-200 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8a6 6 0 0111.33-3M14 8a6 6 0 01-11.33 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M14 2v5h-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Escanear otro
              </button>
              <button
                type="button"
                onClick={() => router.push(`/admin/bookings/${booking.id}`)}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-50 text-brand-blue font-['Poppins',sans-serif] font-semibold text-sm border-none cursor-pointer hover:bg-blue-100 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3l4 4-4 4M6 13l-4-4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Ver detalle
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
