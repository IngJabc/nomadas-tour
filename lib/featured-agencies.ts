import type { MarketplaceAgencyShowcase } from '@/lib/api';

// ── REP-001 · Lógica pura del orden destacado (panel superadmin) ────────────
//
// Todo lo que decide SI un orden es válido y QUÉ se envía al backend vive
// aquí, sin React ni fetch: la página solo orquesta. Reglas del contrato del
// Marketplace (`PATCH /api/admin/agencies/:agencyId`):
//
//   * las posiciones son enteros CONTIGUOS 1..N sobre las destacadas;
//   * una agencia NO destacada jamás recibe `featured_order` (el backend
//     responde 400 si se le envía orden > 0);
//   * al quitar el destacado el backend resetea el orden a 0 (la UI nunca
//     envía orden junto a `is_featured: false`);
//   * el orden guardado se refleja en el directorio público mediante el
//     ORDER BY del backend (`is_featured DESC, featured_order ASC, name
//     ASC`): aquí NO se define ningún mecanismo de ordenación propio.

/** PATCH mínimo y seguro para reposicionar una agencia YA destacada. */
export interface FeaturedSavePatch {
  agencyId: string;
  featured_order: number;
}

export type FeaturedSavePlan =
  | { ok: true; patches: FeaturedSavePatch[] }
  | { ok: false };

/** Ids de las agencias destacadas en el orden exacto que devolvió el backend. */
export function featuredInServerOrder(
  agencies: MarketplaceAgencyShowcase[],
): string[] {
  return agencies.filter((agency) => agency.is_featured).map((agency) => agency.id);
}

/**
 * Un orden local es válido SOLO si es una permutación exacta del conjunto de
 * destacadas del servidor: sin duplicados, sin ids desconocidos y sin faltar
 * ninguna. Cualquier divergencia (carrera con otra pestaña, refetch fallido)
 * invalida el guardado en lugar de enviar valores inválidos.
 */
export function isOrderValid(
  order: string[],
  agencies: MarketplaceAgencyShowcase[],
): boolean {
  const featured = featuredInServerOrder(agencies);
  if (order.length !== featured.length) return false;
  if (new Set(order).size !== order.length) return false;

  const featuredSet = new Set(featured);
  return order.every((id) => featuredSet.has(id));
}

/** ¿Hay cambios locales sin guardar respecto al orden del servidor? */
export function isOrderDirty(
  order: string[],
  agencies: MarketplaceAgencyShowcase[],
): boolean {
  const server = featuredInServerOrder(agencies);
  return (
    order.length !== server.length || order.some((id, i) => id !== server[i])
  );
}

/**
 * Plan de guardado: asigna posiciones contiguas 1..N según el orden local y
 * devuelve SOLO las filas cuyo valor cambió (idempotente, mínimo ruido).
 * `ok: false` si el orden local no representa exactamente a las destacadas:
 * el llamador debe recargar en vez de persistir algo inválido.
 */
export function buildFeaturedSavePlan(
  agencies: MarketplaceAgencyShowcase[],
  order: string[],
): FeaturedSavePlan {
  if (!isOrderValid(order, agencies)) return { ok: false };

  const byId = new Map(agencies.map((agency) => [agency.id, agency]));

  const patches = order
    .map((agencyId, index) => ({
      agencyId,
      featured_order: index + 1,
      current: byId.get(agencyId)!.featured_order,
    }))
    .filter((patch) => patch.current !== patch.featured_order)
    .map(({ agencyId, featured_order }) => ({ agencyId, featured_order }));

  return { ok: true, patches };
}

/**
 * Siguiente posición al destacar: el máximo vigente + 1 (mínimo 1). Nunca
 * duplica un orden existente y ubica la nueva agencia al FINAL del grupo
 * destacado. Solo mira agencias destacadas: el orden de una no destacada es
 * 0 y no cuenta.
 */
export function nextFeaturedPosition(
  agencies: MarketplaceAgencyShowcase[],
): number {
  const orders = agencies
    .filter((agency) => agency.is_featured)
    .map((agency) => agency.featured_order);
  return Math.max(0, ...orders) + 1;
}
