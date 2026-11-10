import { describe, expect, it } from 'vitest';

import type { MarketplaceAgencyShowcase } from '@/lib/api';
import {
  buildFeaturedSavePlan,
  featuredInServerOrder,
  isOrderDirty,
  isOrderValid,
  nextFeaturedPosition,
} from '@/lib/featured-agencies';

// ── REP-001 · Reglas de validación del orden destacado (sin React) ──────────

const agency = (
  id: string,
  overrides: Partial<MarketplaceAgencyShowcase> = {}
): MarketplaceAgencyShowcase => ({
  id,
  name: `Agencia ${id.toUpperCase()}`,
  subdomain: id,
  logo_url: null,
  is_featured: false,
  featured_order: 0,
  ...overrides,
});

const baseAgencies = [
  agency('a1', { is_featured: true, featured_order: 1 }),
  agency('a2', { is_featured: true, featured_order: 2 }),
  agency('a3'),
];

describe('featuredInServerOrder', () => {
  it('devuelve solo las destacadas en el orden del servidor', () => {
    expect(featuredInServerOrder(baseAgencies)).toEqual(['a1', 'a2']);
  });

  it('devuelve vacío cuando no hay destacadas', () => {
    expect(featuredInServerOrder([agency('a3')])).toEqual([]);
  });
});

describe('isOrderValid', () => {
  it('acepta una permutación exacta de las destacadas', () => {
    expect(isOrderValid(['a1', 'a2'], baseAgencies)).toBe(true);
    expect(isOrderValid(['a2', 'a1'], baseAgencies)).toBe(true);
  });

  it('rechaza ids duplicados', () => {
    expect(isOrderValid(['a1', 'a1'], baseAgencies)).toBe(false);
  });

  it('rechaza ids desconocidos', () => {
    expect(isOrderValid(['a1', 'zzz'], baseAgencies)).toBe(false);
  });

  it('rechaza una lista incompleta (falta una destacada)', () => {
    expect(isOrderValid(['a1'], baseAgencies)).toBe(false);
  });

  it('rechaza una lista que incluye agencias no destacadas', () => {
    expect(isOrderValid(['a1', 'a2', 'a3'], baseAgencies)).toBe(false);
  });

  it('rechaza ordenar sobre un listado sin destacadas', () => {
    expect(isOrderValid(['a3'], [agency('a3')])).toBe(false);
  });
});

describe('isOrderDirty', () => {
  it('es limpio cuando el orden coincide con el servidor', () => {
    expect(isOrderDirty(['a1', 'a2'], baseAgencies)).toBe(false);
  });

  it('detecta cambios de posición', () => {
    expect(isOrderDirty(['a2', 'a1'], baseAgencies)).toBe(true);
  });

  it('detecta divergencia cuando falta o sobra una destacada', () => {
    expect(isOrderDirty(['a1'], baseAgencies)).toBe(true);
    expect(isOrderDirty([], baseAgencies)).toBe(true);
  });
});

describe('buildFeaturedSavePlan', () => {
  it('asigna posiciones contiguas 1..N según el orden local', () => {
    const plan = buildFeaturedSavePlan(baseAgencies, ['a2', 'a1']);
    expect(plan).toEqual({
      ok: true,
      patches: [
        { agencyId: 'a2', featured_order: 1 },
        { agencyId: 'a1', featured_order: 2 },
      ],
    });
  });

  it('no envía nada cuando el orden local ya coincide con el servidor', () => {
    expect(buildFeaturedSavePlan(baseAgencies, ['a1', 'a2'])).toEqual({
      ok: true,
      patches: [],
    });
  });

  it('normaliza valores huérfanos (orden 0 en destacada) a 1..N', () => {
    const agencies = [
      agency('a1', { is_featured: true, featured_order: 0 }),
      agency('a2', { is_featured: true, featured_order: 0 }),
    ];
    expect(buildFeaturedSavePlan(agencies, ['a1', 'a2'])).toEqual({
      ok: true,
      patches: [
        { agencyId: 'a1', featured_order: 1 },
        { agencyId: 'a2', featured_order: 2 },
      ],
    });
  });

  it('nunca incluye a una agencia no destacada en los patches', () => {
    const plan = buildFeaturedSavePlan(baseAgencies, ['a2', 'a1']);
    if (plan.ok) {
      expect(plan.patches.every((patch) => patch.agencyId !== 'a3')).toBe(true);
    }
  });

  it('rechaza el plan si el orden local no representa a las destacadas', () => {
    expect(buildFeaturedSavePlan(baseAgencies, ['a1', 'a3'])).toEqual({
      ok: false,
    });
    expect(buildFeaturedSavePlan(baseAgencies, ['a1', 'a1'])).toEqual({
      ok: false,
    });
    expect(buildFeaturedSavePlan(baseAgencies, ['a1'])).toEqual({ ok: false });
  });
});

describe('nextFeaturedPosition', () => {
  it('empieza en 1 cuando no hay destacadas', () => {
    expect(nextFeaturedPosition([agency('a3')])).toBe(1);
  });

  it('va después de la última posición vigente', () => {
    expect(nextFeaturedPosition(baseAgencies)).toBe(3);
  });

  it('ignora el orden de las agencias no destacadas', () => {
    const agencies = [
      agency('a1', { is_featured: true, featured_order: 5 }),
      agency('a3', { featured_order: 99 }),
    ];
    expect(nextFeaturedPosition(agencies)).toBe(6);
  });

  it('nunca duplica una posición existente', () => {
    const agencies = [
      agency('a1', { is_featured: true, featured_order: 0 }),
      agency('a2', { is_featured: true, featured_order: 0 }),
    ];
    const next = nextFeaturedPosition(agencies);
    expect(next).toBe(1);
    expect(next).not.toBe(0);
  });
});
