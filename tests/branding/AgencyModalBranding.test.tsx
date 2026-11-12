import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * Colores de la agencia en los overlays (AS-TRIP-003.1 — follow-up).
 *
 * `AgencyBrandingProvider` inyecta los `--color-*` del tenant en
 * `div[data-agency-branding-scope]`, pero `Modal` se portalaba a
 * `document.body`, FUERA de ese scope: el modal de alta de viaje de la
 * agencia se renderizaba con los tokens Nómadas por defecto en lugar de
 * los colores de la agencia.
 *
 * Verifica:
 *  1. el modal se porta DENTRO del scope (hereda los tokens por cascada),
 *  2. sin provider sigue portalando a `document.body` (comportamiento previo),
 *  3. `buildAgencyBrandingStyle` deriva los tintes de acento nuevos,
 *  4. las fuentes del modal no traen tintes cyan hardcodeados.
 */

const { mockGetBranding, mockUpdateBranding } = vi.hoisted(() => ({
  mockGetBranding: vi.fn(),
  mockUpdateBranding: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    getBranding: () => mockGetBranding(),
    updateBranding: (branding: unknown) => mockUpdateBranding(branding),
  },
}));

import { AgencyBrandingProvider } from '@/components/branding/AgencyBrandingProvider';
import { Modal } from '@/components/ui/Modal';
import {
  buildAgencyBrandingStyle,
  getBrandingPortalHost,
} from '@/lib/brand/utils';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Modal — portal dentro del scope de branding', () => {
  it('portala el diálogo DENTRO de div[data-agency-branding-scope]', async () => {
    mockGetBranding.mockResolvedValue({
      logo_url: null,
      primary_color: '#112233',
      secondary_color: '#445566',
      accent_color: '#778899',
    });

    render(
      <AgencyBrandingProvider>
        <Modal open onClose={vi.fn()}>
          <div>Contenido del modal</div>
        </Modal>
      </AgencyBrandingProvider>,
    );

    const dialog = await screen.findByRole('dialog');
    const scope = document.querySelector(
      '[data-agency-branding-scope]',
    ) as HTMLElement;

    expect(scope).not.toBeNull();
    // Descendiente del scope → las custom properties --color-* heredan hasta
    // el diálogo. Si el portal fuera a document.body esto sería false.
    expect(scope.contains(dialog)).toBe(true);
    expect(dialog.closest('[data-agency-branding-scope]')).toBe(scope);
    expect(getBrandingPortalHost()).toBe(scope);

    // El scope que contiene al modal sí lleva los colores del tenant.
    await waitFor(() => {
      expect(scope.style.getPropertyValue('--color-brand-cyan')).toBe(
        '#778899',
      );
    });
    expect(scope.style.getPropertyValue('--color-brand-navy')).toBe('#112233');
    expect(scope.style.getPropertyValue('--color-cyan-ring')).toContain('15%');
  });

  it('sin provider, el modal sigue portalando a document.body', () => {
    render(
      <Modal open onClose={vi.fn()}>
        <div>Contenido del modal</div>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('[data-agency-branding-scope]')).toBeNull();
    expect(getBrandingPortalHost()).toBe(document.body);
    // Estructura del fallback: body > div.fixed > [role=dialog]
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });
});

describe('buildAgencyBrandingStyle — tintes derivados del accent', () => {
  it('deriva bg-soft, ring y shadow con las opacidades de los defaults', () => {
    const style = buildAgencyBrandingStyle({
      primary_color: null,
      secondary_color: null,
      accent_color: '#778899',
    });

    expect(style['--color-cyan-bg']).toBe(
      'color-mix(in srgb, #778899 10%, transparent)',
    );
    expect(style['--color-cyan-bg-soft']).toBe(
      'color-mix(in srgb, #778899 6%, transparent)',
    );
    expect(style['--color-cyan-ring']).toBe(
      'color-mix(in srgb, #778899 15%, transparent)',
    );
    expect(style['--color-cyan-shadow']).toBe(
      'color-mix(in srgb, #778899 12%, transparent)',
    );
  });

  it('sin accent hex válido no pisa ningún tinte (default de plataforma)', () => {
    const style = buildAgencyBrandingStyle({
      primary_color: null,
      secondary_color: null,
      accent_color: 'no-es-hex',
    });

    expect(style['--color-brand-cyan']).toBeUndefined();
    expect(style['--color-cyan-bg']).toBeUndefined();
    expect(style['--color-cyan-bg-soft']).toBeUndefined();
    expect(style['--color-cyan-ring']).toBeUndefined();
    expect(style['--color-cyan-shadow']).toBeUndefined();
  });

  it('los defaults en design-tokens.css conservan los literales previos', () => {
    const css = read('app/design-tokens.css');

    // Mismo valor que el rgba() hardcodeado que reemplazó cada token →
    // pantallas sin agencia (superadmin, login, etc.) no cambian de look.
    expect(css).toMatch(/--color-cyan-bg-soft:\s*rgba\(0,212,255,0\.06\)/);
    expect(css).toMatch(/--color-cyan-ring:\s*rgba\(0,212,255,0\.15\)/);
    expect(css).toMatch(/--color-cyan-shadow:\s*rgba\(0,212,255,0\.12\)/);
  });
});

describe('fuentes del modal — sin tintes cyan hardcodeados', () => {
  // Todo lo que renderiza AgencyTripBuilderModal (vía BuilderLayout y sus
  // pasos) más los primitivos compartidos que usa: deben referenciar tokens
  // para que sigan al accent de la agencia.
  const MODAL_REACHABLE_SOURCES = [
    'components/agency/AgencyTripBuilderModal.tsx',
    'components/ui/Modal.tsx',
    'components/ui/Card.tsx',
    'components/ui/Button.tsx',
    'components/ui/ConfirmModal.tsx',
    'components/ui/DateTimePicker.tsx',
    'components/ui/day-picker-calendar.tsx',
    'components/ui/EmptyState.tsx',
    'components/admin/trip-builder/BuilderLayout.tsx',
    'components/admin/trip-builder/StepIndicator.tsx',
    'components/admin/trip-builder/RouteStep.tsx',
    'components/admin/trip-builder/ScheduleStep.tsx',
    'components/admin/trip-builder/VehicleStep.tsx',
    'components/admin/trip-builder/AgenciesStep.tsx',
    'components/admin/trip-builder/ReviewStep.tsx',
  ];

  it.each(MODAL_REACHABLE_SOURCES)(
    '%s no contiene rgba(0,212,255,…) ni #00D4FF literal',
    (relPath) => {
      const src = read(relPath);
      expect(src).not.toMatch(/rgba\(\s*0,\s*212,\s*255/);
      expect(src).not.toContain('#00D4FF');
    },
  );

  it('AgencyTripBuilderModal usa el Modal compartido (hereda el portal)', () => {
    expect(read('components/agency/AgencyTripBuilderModal.tsx')).toContain(
      "from '@/components/ui/Modal'",
    );
  });

  it('Modal resuelve el host de branding en vez de document.body directo', () => {
    const src = read('components/ui/Modal.tsx');
    expect(src).toContain('getBrandingPortalHost()');
    expect(src).not.toMatch(/setPortalNode\(document\.body\)/);
  });
});
