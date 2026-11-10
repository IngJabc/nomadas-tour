'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ImageIcon,
  ImageUp,
  Loader2,
  Trash2,
} from 'lucide-react';
import { agencyApi, type AgencyBrandingSettings } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

export const MAX_COVER_FILE_BYTES = 1024 * 1024;
export const ALLOWED_COVER_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

interface CoverUploaderProps {
  currentCoverUrl: string | null;
  disabled?: boolean;
  onBrandingUpdated: (branding: AgencyBrandingSettings) => void;
}

/**
 * Phase 7 — portada del storefront público. Mismo patrón que LogoUploader:
 * valida MIME/1MB en cliente, sube al bucket por agencia y elimina con
 * confirmación (el borrado del objeto en storage lo hace el backend).
 */
export function CoverUploader({
  currentCoverUrl,
  disabled = false,
  onBrandingUpdated,
}: CoverUploaderProps) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = disabled || status === 'uploading';

  useEffect(() => {
    setPreviewFailed(false);
  }, [currentCoverUrl]);

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
      !ALLOWED_COVER_MIME_TYPES.includes(
        file.type as (typeof ALLOWED_COVER_MIME_TYPES)[number],
      )
    ) {
      setValidationError('Selecciona una imagen PNG, JPEG o WEBP');
      return;
    }
    if (file.size > MAX_COVER_FILE_BYTES) {
      setValidationError('La portada no puede superar 1MB');
      return;
    }

    setStatus('uploading');
    setErrorMessage(null);
    try {
      const updated = await agencyApi.uploadCover(file);
      onBrandingUpdated(updated);
      setStatus('success');
      toast.success('Portada actualizada correctamente');
    } catch {
      setStatus('error');
      setErrorMessage('No se pudo subir la portada');
      toast.error('No se pudo subir la portada');
    } finally {
      scheduleStatusReset();
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setStatus('uploading');
    setErrorMessage(null);
    try {
      const updated = await agencyApi.updateBranding({ cover_url: null });
      onBrandingUpdated(updated);
      setConfirmOpen(false);
      setStatus('success');
      toast.success('Portada eliminada correctamente');
    } catch {
      setStatus('error');
      setErrorMessage('No se pudo eliminar la portada');
      toast.error('No se pudo eliminar la portada');
    } finally {
      scheduleStatusReset();
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        <div className="w-full sm:w-48 aspect-[3/1] rounded-2xl bg-[var(--color-brand-dark)] flex items-center justify-center overflow-hidden shrink-0">
          {currentCoverUrl && !previewFailed ? (
            <img
              src={currentCoverUrl}
              alt="Portada actual de la agencia"
              onError={() => setPreviewFailed(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <ImageIcon
              className="w-6 h-6 text-white/50"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)]">
            Sube la portada de tu página pública.
          </p>
          <p className="mt-2 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
            PNG, JPEG o WEBP. Tamaño máximo: 1MB. Recomendado: 1200×400.
          </p>

          <div className="mt-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
            <input
              id="agency-cover-file"
              type="file"
              accept={ALLOWED_COVER_MIME_TYPES.join(',')}
              disabled={busy}
              onChange={handleFileChange}
              className="sr-only"
            />
            <label
              htmlFor="agency-cover-file"
              aria-disabled={busy}
              className={[
                'inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-4 sm:px-5 py-2.5',
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
              {status === 'uploading' ? 'Procesando...' : 'Seleccionar portada'}
            </label>

            <Button
              type="button"
              variant="destructive"
              disabled={busy || !currentCoverUrl}
              onClick={() => setConfirmOpen(true)}
              className="w-full sm:w-auto"
            >
              <Trash2 className="w-4 h-4" strokeWidth={1.75} />
              Eliminar portada
            </Button>
          </div>

          {status === 'error' && errorMessage && (
            <p
              role="alert"
              className="mt-3 font-[family-name:var(--font-body)] text-xs text-[#ef4444]"
            >
              {errorMessage}
            </p>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Eliminar portada"
        message="La página pública volverá a mostrar una portada neutra."
        confirmLabel="Eliminar portada"
        loading={status === 'uploading'}
        onConfirm={handleRemove}
        onCancel={() => {
          if (status !== 'uploading') setConfirmOpen(false);
        }}
      />
    </>
  );
}
