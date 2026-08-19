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