export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export type BrandingStyle = React.CSSProperties &
  Partial<Record<`--${string}`, string>>;

export function buildAgencyBrandingStyle(
  branding: { primary_color: string | null; secondary_color: string | null; accent_color: string | null } | null,
): BrandingStyle {
  if (!branding) return {};

  const style: BrandingStyle = {};

  if (isHexColor(branding.accent_color)) {
    style['--color-brand-cyan'] = branding.accent_color;
    style['--color-cyan-bg'] =
      `color-mix(in srgb, ${branding.accent_color} 10%, transparent)`;
    style['--color-cyan-bg-soft'] =
      `color-mix(in srgb, ${branding.accent_color} 6%, transparent)`;
    style['--color-cyan-ring'] =
      `color-mix(in srgb, ${branding.accent_color} 15%, transparent)`;
    style['--color-cyan-shadow'] =
      `color-mix(in srgb, ${branding.accent_color} 12%, transparent)`;
  }

  if (isHexColor(branding.secondary_color)) {
    style['--color-brand-blue'] = branding.secondary_color;
    style['--color-brand-blue-bg'] =
      `color-mix(in srgb, ${branding.secondary_color} 10%, transparent)`;
  }

  if (isHexColor(branding.primary_color)) {
    style['--color-brand-navy'] = branding.primary_color;
    style['--color-brand-dark'] =
      `color-mix(in srgb, ${branding.primary_color} 34%, black)`;
    style['--color-brand-mid'] =
      `color-mix(in srgb, ${branding.primary_color} 96%, white)`;
  }

  return style;
}

/** Scope donde AgencyBrandingProvider inyecta los tokens de la agencia. */
export const AGENCY_BRANDING_SCOPE_SELECTOR = '[data-agency-branding-scope]';

/**
 * Host de portal para overlays (`Modal`, etc.).
 *
 * `createPortal(..., document.body)` queda FUERA del scope de branding, así
 * que el contenido portaled perdía los colores de la agencia y usaba los
 * tokens por defecto de Nómadas. Si hay un scope activo se porta DENTRO de
 * él (las custom properties heredan por la cascada DOM y el `position:
 * fixed` sigue resolviéndose contra el viewport porque el scope no crea
 * contexto de apilado); sin provider se cae a `document.body` como antes.
 */
export function getBrandingPortalHost(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return (
    document.querySelector<HTMLElement>(AGENCY_BRANDING_SCOPE_SELECTOR) ??
    document.body
  );
}