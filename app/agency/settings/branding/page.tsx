'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ImageIcon, LayoutTemplate, Palette, RotateCcw } from 'lucide-react';
import {
  agencyApi,
  type AgencyBrandingPatch,
  type AgencyBrandingSettings,
} from '@/lib/api';
import {
  buildAgencyBrandingStyle,
  HEX_COLOR_PATTERN,
} from '@/lib/brand/utils';
import { useAgencyBranding } from '@/components/branding/AgencyBrandingProvider';
import { ColorPicker } from '@/components/branding/ColorPicker';
import { PlatformLogoMark } from '@/components/brand/PlatformLogoMark';
import { LogoUploader } from '@/components/agency/LogoUploader';
import { CoverUploader } from '@/components/agency/CoverUploader';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export const NOMADAS_BRANDING_DEFAULTS: AgencyBrandingSettings = {
  logo_url: null,
  primary_color: '#000024',
  secondary_color: '#0080FF',
  accent_color: '#00D4FF',
  cover_url: null,
  description: null,
  slogan: null,
};

export const SLOGAN_MAX_LENGTH = 160;
export const DESCRIPTION_MAX_LENGTH = 2000;

type BrandingFieldErrors = Partial<
  Record<keyof AgencyBrandingSettings, string>
>;

function isValidImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeNullableText(
  value: Partial<AgencyBrandingSettings> | null | undefined,
  key: keyof AgencyBrandingSettings,
): string | null {
  const candidate = value?.[key];
  return typeof candidate === 'string' ? candidate : null;
}

function normalizeBranding(
  branding: Partial<AgencyBrandingSettings> | null,
): AgencyBrandingSettings {
  return {
    logo_url:
      typeof branding?.logo_url === 'string' || branding?.logo_url === null
        ? branding.logo_url
        : null,
    primary_color: HEX_COLOR_PATTERN.test(branding?.primary_color ?? '')
      ? branding!.primary_color!
      : NOMADAS_BRANDING_DEFAULTS.primary_color,
    secondary_color: HEX_COLOR_PATTERN.test(branding?.secondary_color ?? '')
      ? branding!.secondary_color!
      : NOMADAS_BRANDING_DEFAULTS.secondary_color,
    accent_color: HEX_COLOR_PATTERN.test(branding?.accent_color ?? '')
      ? branding!.accent_color!
      : NOMADAS_BRANDING_DEFAULTS.accent_color,
    cover_url:
      typeof branding?.cover_url === 'string' || branding?.cover_url === null
        ? branding.cover_url
        : null,
    description: normalizeNullableText(branding, 'description'),
    slogan: normalizeNullableText(branding, 'slogan'),
  };
}

function validateBranding(
  branding: AgencyBrandingSettings,
): BrandingFieldErrors {
  const errors: BrandingFieldErrors = {};

  if (!HEX_COLOR_PATTERN.test(branding.primary_color)) {
    errors.primary_color = 'Usa un color hexadecimal de 6 dígitos.';
  }
  if (!HEX_COLOR_PATTERN.test(branding.secondary_color)) {
    errors.secondary_color = 'Usa un color hexadecimal de 6 dígitos.';
  }
  if (!HEX_COLOR_PATTERN.test(branding.accent_color)) {
    errors.accent_color = 'Usa un color hexadecimal de 6 dígitos.';
  }
  if ((branding.slogan?.trim().length ?? 0) > SLOGAN_MAX_LENGTH) {
    errors.slogan = `El slogan no puede superar ${SLOGAN_MAX_LENGTH} caracteres.`;
  }
  if ((branding.description?.trim().length ?? 0) > DESCRIPTION_MAX_LENGTH) {
    errors.description = `La descripción no puede superar ${DESCRIPTION_MAX_LENGTH} caracteres.`;
  }
  return errors;
}

export default function AgencyBrandingSettingsPage() {
  const {
    branding: loadedBranding,
    loading,
    error: loadError,
    updateBranding: updateRuntimeBranding,
    refresh,
  } = useAgencyBranding();
  const [branding, setBranding] = useState<AgencyBrandingSettings>(
    () => normalizeBranding(loadedBranding),
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<BrandingFieldErrors>({});
  const [logoPreviewFailed, setLogoPreviewFailed] = useState(false);
  const [coverPreviewFailed, setCoverPreviewFailed] = useState(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loadedBranding) {
      setBranding(normalizeBranding(loadedBranding));
    } else if (!loading && !loadError) {
      setBranding(NOMADAS_BRANDING_DEFAULTS);
    }
  }, [loadedBranding, loading, loadError]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const scheduleFeedbackReset = () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 2000);
  };

  const updateField = <K extends keyof AgencyBrandingSettings>(
    key: K,
    value: AgencyBrandingSettings[K],
  ) => {
    setBranding((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    if (key === 'logo_url') setLogoPreviewFailed(false);
    if (key === 'cover_url') setCoverPreviewFailed(false);
    setFeedback(null);
  };

  const restoreNomadasColors = () => {
    setBranding((current) => ({
      ...current,
      primary_color: NOMADAS_BRANDING_DEFAULTS.primary_color,
      secondary_color: NOMADAS_BRANDING_DEFAULTS.secondary_color,
      accent_color: NOMADAS_BRANDING_DEFAULTS.accent_color,
    }));
    setFieldErrors((current) => ({
      ...current,
      primary_color: undefined,
      secondary_color: undefined,
      accent_color: undefined,
    }));
    setFeedback(null);
  };

  const applyUploadedBranding = (updated: AgencyBrandingSettings) => {
    setBranding(normalizeBranding(updated));
    updateRuntimeBranding(updated);
    setLogoPreviewFailed(false);
    setCoverPreviewFailed(false);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await saveBranding();
  };

  /**
   * Guarda el formulario. Vive fuera del `onSubmit` porque el botón
   * primario ahora está en el PageHeader (mismo patrón que el resto de
   * páginas) y no está envuelto por el <form>.
   */
  const saveBranding = async () => {
    if (saving) return;

    const errors = validateBranding(branding);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error('Revisa los campos antes de guardar');
      return;
    }

    const payload: AgencyBrandingPatch = {
      primary_color: branding.primary_color.toUpperCase(),
      secondary_color: branding.secondary_color.toUpperCase(),
      accent_color: branding.accent_color.toUpperCase(),
      description: branding.description?.trim() || null,
      slogan: branding.slogan?.trim() || null,
    };

    setSaving(true);
    setFeedback(null);
    try {
      const updated = await agencyApi.updateBranding(payload);
      const normalizedBranding = normalizeBranding(updated);
      setBranding(normalizedBranding);
      updateRuntimeBranding(updated);
      setFeedback('success');
      toast.success('Branding actualizado correctamente');
    } catch {
      setFeedback('error');
      toast.error('No se pudo guardar el branding');
    } finally {
      setSaving(false);
      scheduleFeedbackReset();
    }
  };

  const previewLogoUrl =
    branding.logo_url &&
    isValidImageUrl(branding.logo_url) &&
    !logoPreviewFailed
      ? branding.logo_url
      : null;

  const previewCoverUrl =
    branding.cover_url &&
    isValidImageUrl(branding.cover_url) &&
    !coverPreviewFailed
      ? branding.cover_url
      : null;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader
        title="Branding de agencia"
        action={
          !loading && !loadError ? (
            <Button
              type="button"
              loading={saving}
              feedback={feedback}
              onClick={() => void saveBranding()}
              className="w-full sm:w-auto"
            >
              Guardar cambios
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6">
        <SectionTitle>Identidad visual</SectionTitle>
        <p className="mt-3 max-w-3xl font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
          Configura el logo y los colores visibles dentro del espacio de tu
          agencia. El nombre de la agencia solo puede modificarlo el
          administrador.
        </p>
      </div>

      {loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[520px] rounded-2xl" />
          <Skeleton className="h-[520px] rounded-2xl" />
        </div>
      )}

      {!loading && loadError && (
        <Card className="flex flex-col items-start gap-4">
          <div className="flex items-center gap-3 text-[#ef4444]">
            <Palette className="w-5 h-5" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm">
              No se pudo cargar el branding. Intenta de nuevo.
            </p>
          </div>
          <Button variant="secondary" onClick={refresh}>
            Reintentar
          </Button>
        </Card>
      )}

      {!loading && !loadError && (
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="space-y-6">
              <Card>
                <div className="flex items-center gap-3 mb-6">
                  <ImageIcon
                    className="w-5 h-5 text-[var(--color-brand-cyan)]"
                    strokeWidth={1.75}
                  />
                  <h2 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)]">
                    Logo de la agencia
                  </h2>
                </div>

                <LogoUploader
                  currentLogoUrl={branding.logo_url}
                  disabled={saving}
                  onBrandingUpdated={applyUploadedBranding}
                />
              </Card>

              <Card>
                <div className="flex items-center gap-3 mb-6">
                  <LayoutTemplate
                    className="w-5 h-5 text-[var(--color-brand-cyan)]"
                    strokeWidth={1.75}
                  />
                  <h2 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)]">
                    Presentación pública
                  </h2>
                </div>

                <CoverUploader
                  currentCoverUrl={branding.cover_url}
                  disabled={saving}
                  onBrandingUpdated={applyUploadedBranding}
                />

                <div className="mt-6 space-y-6">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor="agency-slogan"
                        className="block font-[family-name:var(--font-body)] font-medium text-xs uppercase tracking-wide text-[var(--color-brand-muted)]"
                      >
                        Slogan
                      </label>
                      <span
                        className={`font-[family-name:var(--font-body)] text-xs ${
                          (branding.slogan?.length ?? 0) > SLOGAN_MAX_LENGTH
                            ? 'text-[#ef4444]'
                            : 'text-[var(--color-brand-muted)]'
                        }`}
                      >
                        {(branding.slogan?.length ?? 0)}/{SLOGAN_MAX_LENGTH}
                      </span>
                    </div>
                    <input
                      id="agency-slogan"
                      type="text"
                      value={branding.slogan ?? ''}
                      disabled={saving}
                      maxLength={SLOGAN_MAX_LENGTH}
                      placeholder="Tu lema comercial junto al nombre"
                      onChange={(event) =>
                        updateField('slogan', event.target.value)
                      }
                      aria-invalid={Boolean(fieldErrors.slogan)}
                      className="mt-2 w-full rounded-[10px] border-[1.5px] border-[#e5e7eb] bg-white px-4 py-3 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] placeholder:text-[var(--color-brand-muted)] focus:border-[var(--color-brand-cyan)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] disabled:opacity-60"
                    />
                    {fieldErrors.slogan && (
                      <p className="mt-2 font-[family-name:var(--font-body)] text-xs text-[#ef4444]">
                        {fieldErrors.slogan}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor="agency-description"
                        className="block font-[family-name:var(--font-body)] font-medium text-xs uppercase tracking-wide text-[var(--color-brand-muted)]"
                      >
                        Descripción comercial
                      </label>
                      <span
                        className={`font-[family-name:var(--font-body)] text-xs ${
                          (branding.description?.length ?? 0) >
                          DESCRIPTION_MAX_LENGTH
                            ? 'text-[#ef4444]'
                            : 'text-[var(--color-brand-muted)]'
                        }`}
                      >
                        {(branding.description?.length ?? 0)}/
                        {DESCRIPTION_MAX_LENGTH}
                      </span>
                    </div>
                    <textarea
                      id="agency-description"
                      rows={5}
                      value={branding.description ?? ''}
                      disabled={saving}
                      maxLength={DESCRIPTION_MAX_LENGTH}
                      placeholder="Cuenta qué hace especial a tu agencia en su página pública"
                      onChange={(event) =>
                        updateField('description', event.target.value)
                      }
                      aria-invalid={Boolean(fieldErrors.description)}
                      className="mt-2 w-full resize-y rounded-[10px] border-[1.5px] border-[#e5e7eb] bg-white px-4 py-3 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] placeholder:text-[var(--color-brand-muted)] focus:border-[var(--color-brand-cyan)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] disabled:opacity-60"
                    />
                    {fieldErrors.description && (
                      <p className="mt-2 font-[family-name:var(--font-body)] text-xs text-[#ef4444]">
                        {fieldErrors.description}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <SectionTitle>Vista previa</SectionTitle>
                <p className="mt-3 mb-6 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                  Los cambios son locales hasta que selecciones Guardar cambios.
                </p>

                <div
                  data-testid="branding-preview"
                  style={buildAgencyBrandingStyle(branding)}
                  className="rounded-2xl overflow-hidden border border-[rgba(0,0,0,0.06)] bg-[var(--color-page-bg)]"
                >
                  {previewCoverUrl && (
                    <img
                      src={previewCoverUrl}
                      alt="Portada en la vista previa"
                      onError={() => setCoverPreviewFailed(true)}
                      className="w-full h-20 object-cover"
                    />
                  )}
                  <div className="bg-[var(--color-brand-dark)] p-4 sm:p-6 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
                      {previewLogoUrl ? (
                        <img
                          src={previewLogoUrl}
                          alt="Logo en la vista previa"
                          width={48}
                          height={48}
                          onError={() => setLogoPreviewFailed(true)}
                          className="w-12 h-12 object-contain"
                        />
                      ) : (
                        <PlatformLogoMark size={40} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-[family-name:var(--font-heading)] font-bold text-white">
                        Nombre de tu agencia
                      </p>
                      {branding.slogan?.trim() ? (
                        <p className="mt-1 truncate font-[family-name:var(--font-body)] text-xs text-white/85">
                          {branding.slogan.trim()}
                        </p>
                      ) : (
                        <p className="mt-1 font-[family-name:var(--font-body)] text-xs text-white/65">
                          Panel Agencia
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="p-4 sm:p-6">
                    {branding.description?.trim() && (
                      <p className="mb-4 line-clamp-4 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                        {branding.description.trim()}
                      </p>
                    )}
                    <div className="rounded-2xl bg-[var(--color-brand-surface)] border border-[rgba(0,0,0,0.06)] p-4 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-[family-name:var(--font-heading)] font-bold text-[var(--color-brand-navy)]">
                            Próximo viaje
                          </p>
                          <p className="mt-1 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                            Caracas → Valencia
                          </p>
                        </div>
                        <Badge variant="info">Activo</Badge>
                      </div>
                      <Button type="button" className="mt-6">
                        Acción principal
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <div className="min-w-0">
                    <h2 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)]">
                      Colores
                    </h2>
                    <p className="mt-1 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                      Usa valores hexadecimales de seis dígitos.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={restoreNomadasColors}
                    className="w-full sm:w-auto px-4 sm:px-5 whitespace-normal text-center leading-snug"
                  >
                    <RotateCcw className="w-4 h-4" strokeWidth={1.75} />
                    Restaurar colores Nómadas
                  </Button>
                </div>

                <div className="space-y-6">
                  <ColorPicker
                    id="primary-color"
                    label="Color primario"
                    description="Identidad oscura, títulos y sidebar."
                    value={branding.primary_color}
                    disabled={saving}
                    error={fieldErrors.primary_color}
                    onChange={(value) => updateField('primary_color', value)}
                  />
                  <ColorPicker
                    id="secondary-color"
                    label="Color secundario"
                    description="Hovers y acentos secundarios."
                    value={branding.secondary_color}
                    disabled={saving}
                    error={fieldErrors.secondary_color}
                    onChange={(value) => updateField('secondary_color', value)}
                  />
                  <ColorPicker
                    id="accent-color"
                    label="Color de acento"
                    description="Acciones principales, foco e indicadores."
                    value={branding.accent_color}
                    disabled={saving}
                    error={fieldErrors.accent_color}
                    onChange={(value) => updateField('accent_color', value)}
                  />
                </div>
              </Card>
            </div>
          </div>
        </form>
      )}
    </main>
  );
}
