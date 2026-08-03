'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  ImageUp,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { agencyApi, type AgencyBrandingSettings } from '@/lib/api';
import { PlatformLogoMark } from '@/components/brand/PlatformLogoMark';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

export const MAX_LOGO_FILE_BYTES = 1024 * 1024;
export const ALLOWED_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

interface LogoUploaderProps {
  currentLogoUrl: string | null;
  disabled?: boolean;
  onBrandingUpdated: (branding: AgencyBrandingSettings) => void;
}

export function LogoUploader({
  currentLogoUrl,
  disabled = false,
  onBrandingUpdated,
}: LogoUploaderProps) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = disabled || status === 'uploading';

  useEffect(() => {
    setPreviewFailed(false);
  }, [currentLogoUrl]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const scheduleStatusReset = () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setStatus('idle'), 2500);
  };

  const setValidationError = (message: string) => {
    setStatus('error');
    setErrorMessage(message);
    toast.error(message);
    scheduleStatusReset();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;

    if (
      !ALLOWED_LOGO_MIME_TYPES.includes(
        file.type as (typeof ALLOWED_LOGO_MIME_TYPES)[number],
      )
    ) {
      setValidationError('Selecciona una imagen PNG, JPEG o WEBP');
      return;
    }
    if (file.size > MAX_LOGO_FILE_BYTES) {
      setValidationError('El logo no puede superar 1MB');
      return;
    }

    setStatus('uploading');
    setErrorMessage(null);
    try {
      const updated = await agencyApi.uploadLogo(file);
      onBrandingUpdated(updated);
      setStatus('success');
      toast.success('Logo actualizado correctamente');
    } catch {
      setStatus('error');
      setErrorMessage('No se pudo subir el logo');
      toast.error('No se pudo subir el logo');
    } finally {
      scheduleStatusReset();
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setStatus('uploading');
    setErrorMessage(null);
    try {
      const updated = await agencyApi.updateBranding({ logo_url: null });
      onBrandingUpdated(updated);
      setConfirmOpen(false);
      setStatus('success');
      toast.success('Logo eliminado correctamente');
    } catch {
      setStatus('error');
      setErrorMessage('No se pudo eliminar el logo');
      toast.error('No se pudo eliminar el logo');
    } finally {
      scheduleStatusReset();
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        <div className="w-24 h-24 rounded-2xl bg-[var(--color-brand-dark)] flex items-center justify-center overflow-hidden shrink-0">
          {currentLogoUrl && !previewFailed ? (
            <img
              src={currentLogoUrl}
              alt="Logo actual de la agencia"
              width={96}
              height={96}
              onError={() => setPreviewFailed(true)}
              className="w-24 h-24 object-contain"
            />
          ) : (
            <PlatformLogoMark size={64} />
          )}
        </div>

        <div className="flex-1">
          <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)]">
            Sube una imagen cuadrada o apaisada. Se mostrará en el sidebar de
            la agencia.
          </p>
          <p className="mt-2 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
            PNG, JPEG o WEBP. Tamaño máximo: 1MB.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              id="agency-logo-file"
              type="file"
              accept={ALLOWED_LOGO_MIME_TYPES.join(',')}
              disabled={busy}
              onChange={handleFileChange}
              className="sr-only"
            />
            <label
              htmlFor="agency-logo-file"
              aria-disabled={busy}
              className={[
                'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5',
                'font-[family-name:var(--font-body)] font-semibold text-sm',
                'bg-slate-100 text-[var(--color-brand-navy)] hover:bg-slate-200 transition-colors',
                busy
                  ? 'opacity-40 cursor-not-allowed pointer-events-none'
                  : 'cursor-pointer',
              ].join(' ')}
            >
              {status === 'uploading' ? (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
              ) : (
                <ImageUp className="w-4 h-4" strokeWidth={1.75} />
              )}
              {status === 'uploading' ? 'Procesando...' : 'Seleccionar logo'}
            </label>

            <Button
              type="button"
              variant="destructive"
              disabled={busy || !currentLogoUrl}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="w-4 h-4" strokeWidth={1.75} />
              Eliminar logo
            </Button>
          </div>

         
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Eliminar logo"
        message="La agencia volverá a mostrar el logo de Nómadas como fallback."
        confirmLabel="Eliminar logo"
        loading={status === 'uploading'}
        onConfirm={handleRemove}
        onCancel={() => {
          if (status !== 'uploading') setConfirmOpen(false);
        }}
      />
    </>
  );
}
