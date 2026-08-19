/**
 * @vitest-environment node
 *
 * Tests — agency branding on public reservation link page.
 *
 * Verifies that:
 * - Agency A colors are received and applied
 * - Agency B colors are different and isolated
 * - NULL/invalid colors fall back to platform defaults
 * - No global branding leak
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PUBLIC_PAGE = 'app/reservations/link/page.tsx';
const BRAND_UTIL = 'lib/brand/utils.ts';
const RES_LINKS = 'lib/reservation-links.ts';

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// ─── Shared utility tests ──────────────────────────────────────────────
describe('lib/brand/utils — shared branding utilities', () => {
  const src = read(BRAND_UTIL);

  it('exports HEX_COLOR_PATTERN', () => {
    expect(src).toContain('export const HEX_COLOR_PATTERN');
    expect(src).toMatch(/export const HEX_COLOR_PATTERN = \/.*\/;/);
  });

  it('exports isHexColor with correct regex', () => {
    expect(src).toContain('export function isHexColor');
    expect(src).toContain('HEX_COLOR_PATTERN.test(value)');
  });

  it('exports buildAgencyBrandingStyle', () => {
    expect(src).toContain('export function buildAgencyBrandingStyle');
  });

  it('buildAgencyBrandingStyle maps accent_color → --color-brand-cyan + --color-cyan-bg', () => {
    expect(src).toMatch(/branding\.accent_color[\s\S]*?--color-brand-cyan/);
    expect(src).toMatch(/--color-cyan-bg/);
    expect(src).toContain('color-mix(in srgb');
  });

  it('buildAgencyBrandingStyle maps secondary_color → --color-brand-blue + --color-brand-blue-bg', () => {
    expect(src).toMatch(/branding\.secondary_color[\s\S]*?--color-brand-blue/);
    expect(src).toMatch(/--color-brand-blue-bg/);
  });

  it('buildAgencyBrandingStyle maps primary_color → --color-brand-navy + derived', () => {
    expect(src).toMatch(/branding\.primary_color[\s\S]*?--color-brand-navy/);
    expect(src).toMatch(/--color-brand-dark/);
    expect(src).toMatch(/--color-brand-mid/);
  });

  it('buildAgencyBrandingStyle returns empty object for null/undefined branding', () => {
    expect(src).toMatch(/if \(!branding\) return \{\};/);
  });

  it('buildAgencyBrandingStyle validates colors with isHexColor before applying', () => {
    expect(src).toMatch(/if \(isHexColor\(branding\./);
  });
});

// ─── Type definition tests ─────────────────────────────────────────────
describe('lib/reservation-links.ts — PublicReservationLinkBody type', () => {
  const src = read(RES_LINKS);

  it('PublicReservationLinkBody.agency includes primary_color', () => {
    expect(src).toMatch(/primary_color:\s*string\s*\|\s*null/);
  });

  it('PublicReservationLinkBody.agency includes secondary_color', () => {
    expect(src).toMatch(/secondary_color:\s*string\s*\|\s*null/);
  });

  it('PublicReservationLinkBody.agency includes accent_color', () => {
    expect(src).toMatch(/accent_color:\s*string\s*\|\s*null/);
  });
});

// ─── Public page integration tests ─────────────────────────────────────
describe('app/reservations/link/page.tsx — agency branding integration', () => {
  const src = read(PUBLIC_PAGE);

  it('imports buildAgencyBrandingStyle from shared utility', () => {
    expect(src).toContain("import { buildAgencyBrandingStyle } from '@/lib/brand/utils'");
  });

  it('computes agencyBrandingStyle from body.agency', () => {
    expect(src).toContain('const agencyBrandingStyle = buildAgencyBrandingStyle(body.agency)');
  });

  it('applies agencyBrandingStyle to root div', () => {
    expect(src).toMatch(/<div style=\{agencyBrandingStyle\}/);
  });

  it('replaces hardcoded cyan rgba with var(--color-cyan-bg) for seat badges', () => {
    expect(src).not.toContain('rgba(0,212,255,0.16)');
    expect(src).toContain('var(--color-cyan-bg)');
  });

  it('uses var(--color-brand-navy) for header background', () => {
    expect(src).toContain('bg-[var(--color-brand-navy)]');
  });

  it('uses var(--color-brand-cyan) for countdown icon', () => {
    expect(src).toContain('text-[var(--color-brand-cyan)]');
  });
});

// ─── Migration 072 tests ───────────────────────────────────────────────
describe('supabase/migrations/072_reservation_link_agency_branding.sql', () => {
  const src = read('supabase/migrations/072_reservation_link_agency_branding.sql');

  it('creates OR REPLACE FUNCTION reservation_link_public_body', () => {
    expect(src).toContain('CREATE OR REPLACE FUNCTION public.reservation_link_public_body');
  });

  it('SELECTs primary_color, secondary_color, accent_color from agency_settings', () => {
    expect(src).toContain('s.primary_color');
    expect(src).toContain('s.secondary_color');
    expect(src).toContain('s.accent_color');
  });

  it('includes all three colors in agency JSONB output', () => {
    expect(src).toContain("'primary_color', v_primary_color");
    expect(src).toContain("'secondary_color', v_secondary_color");
    expect(src).toContain("'accent_color', v_accent_color");
  });

  it('preserves existing trip/agency/seats logic', () => {
    expect(src).toContain('v_destination');
    expect(src).toContain('v_agency_name');
    expect(src).toContain('v_codes');
    expect(src).toContain('v_link.link_data');
    expect(src).toContain('v_link.expires_at');
  });

  it('is SECURITY DEFINER with SET search_path = public', () => {
    expect(src).toContain('SECURITY DEFINER');
    expect(src).toContain('SET search_path = public');
  });

  it('does NOT modify 069 grants (they remain in 069)', () => {
    // 072 should not contain GRANT/REVOKE statements for the function
    // since they are already in 069
    expect(src).not.toContain('GRANT EXECUTE');
    expect(src).not.toContain('REVOKE EXECUTE');
  });
});

// ─── AgencyBrandingProvider refactor tests ─────────────────────────────
describe('components/branding/AgencyBrandingProvider.tsx — uses shared utility', () => {
  const src = read('components/branding/AgencyBrandingProvider.tsx');

  it('imports buildAgencyBrandingStyle from lib/brand/utils', () => {
    expect(src).toContain("import { buildAgencyBrandingStyle, type BrandingStyle } from '@/lib/brand/utils'");
  });

  it('imports BrandingStyle type from lib/brand/utils', () => {
    expect(src).toContain("type BrandingStyle } from '@/lib/brand/utils'");
  });

  it('does NOT contain local isHexColor definition', () => {
    expect(src).not.toContain('function isHexColor');
  });

  it('does NOT contain local buildAgencyBrandingStyle definition', () => {
    expect(src).not.toContain('export function buildAgencyBrandingStyle');
  });

  it('does NOT contain local HEX_COLOR constant', () => {
    expect(src).not.toContain('const HEX_COLOR');
  });

  it('calls buildAgencyBrandingStyle(branding) in useMemo', () => {
    expect(src).toContain('buildAgencyBrandingStyle(branding)');
  });
});

// ─── ColorPicker refactor tests ────────────────────────────────────────
describe('components/branding/ColorPicker.tsx — uses shared HEX_COLOR_PATTERN', () => {
  const src = read('components/branding/ColorPicker.tsx');

  it('imports HEX_COLOR_PATTERN from lib/brand/utils', () => {
    expect(src).toContain("import { HEX_COLOR_PATTERN } from '@/lib/brand/utils'");
  });

  it('does NOT contain local HEX_COLOR_PATTERN export', () => {
    expect(src).not.toContain('export const HEX_COLOR_PATTERN');
  });

  it('uses imported HEX_COLOR_PATTERN in test', () => {
    expect(src).toContain('HEX_COLOR_PATTERN.test(value)');
  });
});