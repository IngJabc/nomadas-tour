"use client";

import toast from 'react-hot-toast';
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDateLong, formatTime12h } from "@/lib/timezone";
import { Html5Qrcode } from "html5-qrcode";
import type { Html5QrcodeResult } from "html5-qrcode";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  XCircle,
  QrCode,
  Search,
  UserCheck,
} from "lucide-react";
import { agencyApi } from "@/lib/api";
import { subscribeToBoardingLogs } from "@/lib/realtime/subscriptions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Spinner } from "@/components/ui/Spinner";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  pageFade,
  staggerContainer,
  staggerItem,
  slideUp,
} from "@/lib/motion/variants";

type PassengerInfo = {
  id: string;
  name: string;
  document: string;
  seat_id: string;
  boarded: boolean;
  boarded_at: string | null;
};

type ScanLookupResult = {
  reservation_id: string;
  trip_id: string;
  booker_name: string;
  booker_document: string;
  reservation_agency_name: string;
  departure_time: string | null;
  route: { origin: string; destination: string } | null;
  passengers: PassengerInfo[];
};

function computeBadge(passengers: PassengerInfo[]): {
  label: string;
  variant: "confirmed" | "boarded" | "cancelled";
} {
  const allBoarded =
    passengers.length > 0 && passengers.every((p) => p.boarded);
  const someBoarded = passengers.some((p) => p.boarded);
  if (allBoarded) return { label: "Completado", variant: "boarded" };
  if (someBoarded) return { label: "Parcial", variant: "confirmed" };
  return { label: "Confirmada", variant: "confirmed" };
}

function SuccessAnimation({ showConfetti }: { showConfetti: boolean }) {
  return (
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
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <CheckCircle size={44} stroke="white" strokeWidth={3} />
          </motion.div>
          {Array.from({ length: 12 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-3 h-3 rounded-full"
              style={{
                background: [
                  "var(--color-brand-cyan)",
                  "#10b981",
                  "#f59e0b",
                  "var(--color-brand-blue)",
                ][i % 4],
              }}
              initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
              animate={{
                x: Math.cos((i * 30 * Math.PI) / 180) * 140,
                y: Math.sin((i * 30 * Math.PI) / 180) * 140,
                scale: 0,
                opacity: 0,
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function AgencyScanPage() {
  return <AgencyScanContent />;
}

function AgencyScanContent() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanSuccessRef = useRef<
    ((decodedText: string, result: Html5QrcodeResult) => void) | null
  >(null!);
  const currentQrRef = useRef<string | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [initializingCamera, setInitializingCamera] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFacingError, setCameraFacingError] = useState(false);
  const [scanResult, setScanResult] = useState<ScanLookupResult | null>(null);
  const [loadingBooking, setLoadingBooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [manualQrValue, setManualQrValue] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setInitialLoad(false), 350);
    return () => clearTimeout(t);
  }, []);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        /* ignore */
      }
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
      const result = await agencyApi.lookupPassengerByQR(qrCode);
      if (!result.passengers || result.passengers.length === 0) {
        setLookupError("Reserva sin pasajeros");
        setScanResult(null);
        currentQrRef.current = null;
        return;
      }
      currentQrRef.current = qrCode;
      setScanResult(result);
    } catch (err: any) {
      setLookupError(err?.message || "Error al buscar reserva");
      setScanResult(null);
      currentQrRef.current = null;
    } finally {
      setLoadingBooking(false);
    }
  }, []);

  const onScanSuccess = useCallback(
    async (decodedText: string, _result: Html5QrcodeResult) => {
      await stopCamera();
      await lookupByQR(decodedText);
    },
    [stopCamera, lookupByQR]
  );

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
        const scanner = new Html5Qrcode("qr-reader-container");
        const scanHandler = (
          decodedText: string,
          result: Html5QrcodeResult
        ) => {
          onScanSuccessRef.current?.(decodedText, result);
        };
        await scanner.start(
          { facingMode },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          scanHandler,
          () => {}
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
      const envOk = await startWithFacing("environment");
      if (cancelled) return;
      if (!envOk) {
        setCameraFacingError(true);
        const userOk = await startWithFacing("user");
        if (cancelled) return;
        if (!userOk) {
          setCameraError(
            "No se pudo acceder a la cámara. Verifica los permisos."
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

  // ─── Realtime: refetch when boarding changes on current reservation ──
  useEffect(() => {
    if (!scanResult) return;
    const reservationId = scanResult.reservation_id;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = subscribeToBoardingLogs((log) => {
      if (log.reservation_id !== reservationId) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (currentQrRef.current) {
          lookupByQR(currentQrRef.current);
        }
      }, 500);
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      cleanup();
    };
  }, [scanResult?.reservation_id, lookupByQR]);

  const handleStartCamera = () => {
    setCameraError(null);
    setScanResult(null);
    setLookupError(null);
    setSuccessMsg(null);
    setShowConfetti(false);
    setManualQrValue("");
    setScanning(true);
  };

  const handleManualLookup = async () => {
    const qr = manualQrValue.trim();
    if (!qr) return;
    await stopCamera();
    await lookupByQR(qr);
  };

  const handleToggleBoarding = useCallback(
    async (passengerId: string, currentlyBoarded: boolean) => {
      setTogglingIds((prev) => new Set(prev).add(passengerId));
      setLookupError(null);
      setSuccessMsg(null);
      try {
        await agencyApi.toggleBoarding(passengerId, !currentlyBoarded);
        setScanResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            passengers: prev.passengers.map((p) =>
              p.id === passengerId
                ? {
                    ...p,
                    boarded: !currentlyBoarded,
                    boarded_at: !currentlyBoarded
                      ? new Date().toISOString()
                      : null,
                  }
                : p
            ),
          };
        });
        if (!currentlyBoarded) {
          setSuccessMsg("Abordaje confirmado");
          toast.success('Abordaje confirmado');
        } else {
          setSuccessMsg("Abordaje cancelado");
          toast.success('Abordaje cancelado');
        }
      } catch (err: any) {
        setLookupError(err?.message || "Error al actualizar abordaje");
        toast.error(err?.message || 'Error al actualizar abordaje');
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(passengerId);
          return next;
        });
      }
    },
    []
  );

  const handleBulkBoarding = useCallback(async () => {
    const unboarded = scanResult?.passengers.filter((p) => !p.boarded) ?? [];
    if (unboarded.length === 0) return;
    setBulkLoading(true);
    setLookupError(null);
    setSuccessMsg(null);
    try {
      const now = new Date().toISOString();
      await Promise.all(
        unboarded.map((p) => agencyApi.toggleBoarding(p.id, true))
      );
      setScanResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          passengers: prev.passengers.map((p) =>
            p.boarded ? p : { ...p, boarded: true, boarded_at: now }
          ),
        };
      });
      setSuccessMsg(`${unboarded.length} pasajero(s) abordado(s)`);
      toast.success(`${unboarded.length} pasajero(s) abordado(s)`);
    } catch (err: any) {
      setLookupError(err?.message || "Error al abordar pasajeros");
      toast.error(err?.message || 'Error al abordar pasajeros');
    } finally {
      setBulkLoading(false);
    }
  }, [scanResult]);

  const handleReset = () => {
    setScanResult(null);
    setLookupError(null);
    setSuccessMsg(null);
    setCameraError(null);
    setShowConfetti(false);
    setManualQrValue("");
    currentQrRef.current = null;
    setScanning(true);
  };

  const handleRetryCamera = () => {
    setCameraError(null);
    setCameraFacingError(false);
    setScanning(true);
  };

  const badge = scanResult ? computeBadge(scanResult.passengers) : null;

  if (initialLoad) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <Skeleton className="h-7 w-52 mb-1" />
          <Skeleton className="h-3.5 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-6">
          <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-[18px] bg-slate-200 rounded-sm" />
                <Skeleton className="h-5 w-44" />
              </div>
            </div>
            <div className="flex flex-col items-center gap-4 py-8">
              <Skeleton className="w-20 h-20 rounded-2xl" />
              <Skeleton className="h-11 w-40 rounded-xl" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-1 h-[18px] bg-slate-200 rounded-sm" />
              <Skeleton className="h-5 w-52" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-12 flex-1 rounded-xl" />
              <Skeleton className="h-12 w-12 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <SuccessAnimation showConfetti={showConfetti} />

      <motion.div variants={pageFade} initial="hidden" animate="visible">
        <PageHeader title="Escáner de abordaje" className="mb-0" />
        <p className="font-[family-name:var(--font-body)] font-normal text-[13px] text-[var(--color-brand-muted)] mb-6">
          Escanea el código QR para confirmar abordaje
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-6">
        <AnimatePresence mode="wait">
          {!scanResult && (
            <motion.div
              key="scanner"
              variants={pageFade}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="contents"
            >
              <Card>
                <div className="flex items-center gap-3 mb-4">
                  <SectionTitle>
                    {scanning ? "Enfoca el código QR del pasajero" : "Escáner"}
                  </SectionTitle>
                  {cameraReady && (
                    <span className="ml-auto inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] font-semibold text-[10px] text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Cámara activa
                    </span>
                  )}
                </div>

                {!scanning && !lookupError && (
                  <motion.div
                    variants={slideUp}
                    initial="hidden"
                    animate="visible"
                    className="flex flex-col items-center gap-4 py-8"
                  >
                    <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center">
                      <Camera className="w-10 h-10 text-[var(--color-brand-muted)]" />
                    </div>
                    <Button onClick={handleStartCamera} size="lg">
                      Iniciar escáner
                    </Button>
                    <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)] text-center max-w-xs">
                      O busca al pasajero desde la lista de reservas
                    </p>
                  </motion.div>
                )}

                {scanning && !cameraReady && !cameraError && (
                  <motion.div
                    variants={slideUp}
                    initial="hidden"
                    animate="visible"
                    className="flex flex-col items-center gap-4 py-12"
                  >
                    <Spinner size={40} text="Iniciando cámara..." />
                  </motion.div>
                )}

                {cameraError && (
                  <motion.div
                    variants={slideUp}
                    initial="hidden"
                    animate="visible"
                    className="py-6 text-center"
                  >
                    <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <XCircle className="w-6 h-6 text-red-500" />
                    </div>
                    <p className="font-[family-name:var(--font-body)] font-normal text-sm text-red-500 mb-3">
                      {cameraError}
                    </p>
                    <div className="flex gap-3 justify-center flex-wrap">
                      <Button onClick={handleRetryCamera} size="sm">
                        Reintentar cámara
                      </Button>
                    </div>
                  </motion.div>
                )}

                {scanning && !cameraError && (
                  <motion.div
                    variants={slideUp}
                    initial="hidden"
                    animate="visible"
                  >
                    <div className="relative w-full max-w-sm mx-auto">
                      <div
                        id="qr-reader-container"
                        className="w-full rounded-xl overflow-hidden"
                      />
                      {cameraReady && (
                        <div className="absolute inset-x-0 top-0 h-full pointer-events-none overflow-hidden rounded-xl">
                          <motion.div
                            className="absolute left-[10%] right-[10%] h-[2px] bg-[var(--color-brand-cyan)] shadow-[0_0_8px_rgba(0,212,255,0.7)]"
                            animate={{ top: ["5%", "95%"] }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              ease: "linear",
                            }}
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
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={stopCamera}
                        >
                          Detener cámara
                        </Button>
                      </div>
                    )}
                  </motion.div>
                )}

                {lookupError && !loadingBooking && (
                  <motion.div
                    variants={slideUp}
                    initial="hidden"
                    animate="visible"
                    className="py-6 text-center"
                  >
                    <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <XCircle className="w-6 h-6 text-red-500" />
                    </div>
                    <p className="font-[family-name:var(--font-body)] font-normal text-sm text-red-500 mb-4">
                      {lookupError}
                    </p>
                    <div className="flex gap-3 justify-center flex-wrap">
                      <Button onClick={handleReset}>Escanear otro</Button>
                    </div>
                  </motion.div>
                )}
              </Card>

              <motion.div
                variants={slideUp}
                initial="hidden"
                animate="visible"
              >
                <Card>
                  <SectionTitle>O ingresa el código manualmente</SectionTitle>
                  <div className="mt-3 flex gap-2">
                    <div className="flex-1">
                      <Input
                        label="Código QR"
                        placeholder="Pega el código aquí"
                        value={manualQrValue}
                        onChange={(e) => setManualQrValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleManualLookup();
                        }}
                        leftIcon={<QrCode className="w-4 h-4 text-[#6b7280]" />}
                      />
                    </div>
                    <Button
                      className="mt-[22px]"
                      onClick={handleManualLookup}
                      disabled={!manualQrValue.trim() || loadingBooking}
                    >
                      <Search className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              </motion.div>

            </motion.div>
          )}

          {loadingBooking && (
            <motion.div
              key="loading"
              variants={pageFade}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <Card borderLeft borderColor="var(--color-brand-cyan)">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <SectionTitle>Buscando reserva...</SectionTitle>
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <div className="space-y-3">
                  <div>
                    <Skeleton className="h-2.5 w-12 mb-1.5" />
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-36 mt-1" />
                  </div>
                  <div>
                    <Skeleton className="h-2.5 w-20 mb-1.5" />
                    <Skeleton className="h-4 w-56" />
                  </div>
                </div>
                <div className="border-t border-[#e5e7eb] pt-4 mt-4">
                  <Skeleton className="h-2.5 w-32 mb-3" />
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-2 px-3 rounded-xl bg-[#f8fafc] border border-[#e5e7eb]"
                      >
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                        <Skeleton className="h-7 w-[52px] rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {scanResult && !loadingBooking && (
            <motion.div
              key="result"
              variants={pageFade}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="contents"
            >
              <Card borderLeft borderColor="var(--color-brand-cyan)">
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                >
                <motion.div variants={staggerItem} className="flex items-center justify-between gap-3 mb-4">
                  <SectionTitle>Reserva encontrada</SectionTitle>
                  {badge && (
                    <Badge variant={badge.variant} size="md">
                      {badge.label}
                    </Badge>
                  )}
                </motion.div>

                {successMsg && (
                  <motion.div variants={staggerItem} className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span className="font-[family-name:var(--font-body)] font-semibold text-sm text-emerald-700">
                      {successMsg}
                    </span>
                  </motion.div>
                )}

                <motion.div variants={staggerItem} className="mb-5 space-y-3">
                  <div>
                    <label className="block font-[family-name:var(--font-body)] font-medium text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider mb-1">
                      Destino
                    </label>
                    <p className="font-[family-name:var(--font-body)] font-semibold text-[15px] text-[var(--color-brand-navy)]">
                      {scanResult.route?.destination ?? "—"}
                    </p>
                    <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)]">
                      {scanResult.departure_time
                        ? `${formatDateLong(scanResult.departure_time)}`
                        : ""}
                    </p>
                  </div>
                  <div>
                    <label className="block font-[family-name:var(--font-body)] font-medium text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider mb-1">
                      Reservado por
                    </label>
                    <p className="font-[family-name:var(--font-body)] font-semibold text-[15px] text-[var(--color-brand-navy)]">
                      {scanResult.booker_name} · {scanResult.booker_document}
                    </p>
                    {scanResult.reservation_agency_name && (
                      <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)]">
                        Agencia: {scanResult.reservation_agency_name}
                      </p>
                    )}
                  </div>
                </motion.div>

                <motion.div variants={staggerItem} className="border-t border-[#e5e7eb] pt-4">
                  <label className="block font-[family-name:var(--font-body)] font-medium text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider mb-3">
                    Pasajeros (
                    {scanResult.passengers.filter((p) => p.boarded).length}/
                    {scanResult.passengers.length} abordados)
                  </label>
                  <div className="space-y-2">
                    {scanResult.passengers.map((passenger) => (
                      <div
                        key={passenger.id}
                        className="flex items-center justify-between py-2 px-3 rounded-xl bg-[#f8fafc] border border-[#e5e7eb]"
                      >
                        <div className="min-w-0">
                          <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[#000024]">
                            {passenger.name}
                          </p>
                          <p className="font-[family-name:var(--font-body)] text-xs text-[#6b7280]">
                            {passenger.document}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className={`font-[family-name:var(--font-body)] text-xs font-semibold ${
                              passenger.boarded
                                ? "text-[#10b981]"
                                : "text-[#6b7280]"
                            }`}
                          >
                            {passenger.boarded ? "Abordado" : "Pendiente"}
                          </span>
                          <button
                            type="button"
                            disabled={togglingIds.has(passenger.id)}
                            onClick={() =>
                              handleToggleBoarding(
                                passenger.id,
                                passenger.boarded
                              )
                            }
                            className={`
                          relative inline-flex h-[28px] w-[52px] shrink-0 cursor-pointer items-center rounded-full
                          transition-colors duration-200 ease-in-out
                          ${passenger.boarded ? "bg-[#10b981]" : "bg-[#e5e7eb]"}
                          ${
                            togglingIds.has(passenger.id)
                              ? "opacity-50 cursor-not-allowed"
                              : ""
                          }
                        `}
                            role="switch"
                            aria-checked={passenger.boarded}
                          >
                            <span
                              className={`
                            inline-block h-[22px] w-[22px] transform rounded-full bg-white shadow-sm
                            transition-transform duration-200 ease-in-out
                            ${
                              passenger.boarded
                                ? "translate-x-[27px]"
                                : "translate-x-[3px]"
                            }
                          `}
                            />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>

                <motion.div variants={staggerItem} className="border-t border-[#e5e7eb] pt-4 mt-4 flex flex-wrap gap-3">
                  {scanResult.passengers.some((p) => !p.boarded) && (
                    <Button
                      onClick={handleBulkBoarding}
                      loading={bulkLoading}
                      size="lg"
                    >
                      <UserCheck className="w-4 h-4" />
                      Marcar todos como abordados
                    </Button>
                  )}
                  <Button variant="secondary" size="lg" onClick={handleReset}>
                    <RotateCcw className="w-4 h-4" />
                    Escanear otro
                  </Button>
                </motion.div>
                </motion.div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
