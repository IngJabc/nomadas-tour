"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Save,
  Star,
  StarOff,
} from "lucide-react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";

import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  AdminSkeletonItem,
  AdminSkeletonShell,
} from "@/components/admin/skeleton/AdminSkeletonMotion";

import { marketplaceAdminApi, type MarketplaceAgencyShowcase } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors/api-error";
import {
  buildFeaturedSavePlan,
  featuredInServerOrder,
  isOrderDirty,
  nextFeaturedPosition,
} from "@/lib/featured-agencies";
import { pageFade, staggerContainer, staggerItem } from "@/lib/motion/variants";

// ── REP-001 · Destacados y orden manual del directorio público ──────────────
//
// Superadmin del Marketplace dentro del panel de Tour. Listado, destacar /
// quitar y orden manual de las agencias activas del directorio público.
// El backend del Marketplace es la ÚNICA fuente de verdad:
//
//   * listado  → GET  /api/public/agencies  (activas, ya ordenadas por
//                 `is_featured DESC, featured_order ASC, name ASC`);
//   * cambios  → PATCH /api/admin/agencies/:agencyId (superadmin);
//   * el guardado reutiliza ese ORDER BY: aquí NO hay segunda mecánica de
//     ordenación (la página solo pinta la secuencia que devuelve el servidor).
//
// Presentación: mismo lenguaje visual que el resto del panel de Tour
// (PageHeader con acción principal, SectionTitle, Card, Badge, skeletons
// del admin). Sin párrafos introductorios ni estilos propios de sección.

/** Logo de agencia con respaldo: si no hay URL o la imagen falla, icono. */
function AgencyLogo({ agency }: { agency: MarketplaceAgencyShowcase }) {
  const [failed, setFailed] = useState(false);

  // Un logo nuevo (otra agencia) vuelve a intentar cargar.
  useEffect(() => {
    setFailed(false);
  }, [agency.logo_url]);

  if (agency.logo_url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- logos remotos
      // de agencias: dominios arbitrarios, fuera de la config de imágenes.
      <img
        src={agency.logo_url}
        alt={`Logo de ${agency.name}`}
        onError={() => setFailed(true)}
        className="h-10 w-10 shrink-0 rounded-[10px] object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(0,212,255,0.1)]"
    >
      <Building2
        className="h-5 w-5 text-[var(--color-brand-cyan)]"
        strokeWidth={1.75}
      />
    </span>
  );
}

function FeaturedBadge() {
  return (
    <Badge variant="info" size="sm" className="gap-1">
      <Star size={10} strokeWidth={2} fill="currentColor" aria-hidden />
      Destacada
    </Badge>
  );
}

/** Botón icono de 28px (estilo paginación de Viajes). */
const iconButtonClass =
  "flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-[var(--color-brand-muted)] transition-colors hover:bg-slate-100 hover:text-[var(--color-brand-navy)] disabled:cursor-not-allowed disabled:opacity-40";

export default function FeaturedAgenciesPage() {
  const [agencies, setAgencies] = useState<MarketplaceAgencyShowcase[]>([]);
  // Orden LOCAL de las destacadas (ids). Se reconstruye desde el servidor en
  // cada refetch; mientras haya cambios sin guardar se conserva (regla 11).
  const [order, setOrder] = useState<string[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [unfeatureTarget, setUnfeatureTarget] =
    useState<MarketplaceAgencyShowcase | null>(null);
  const [unfeatureLoading, setUnfeatureLoading] = useState(false);
  const unfeatureRef = useRef(false);
  const allListRef = useRef<HTMLElement>(null);

  const doFetch = useCallback(async () => {
    try {
      const result = await marketplaceAdminApi.listShowcaseAgencies();
      setAgencies(result.agencies);
      setOrder(featuredInServerOrder(result.agencies));
      setFetchError(null);
    } catch {
      setFetchError(
        "No se pudieron cargar las agencias del marketplace. Intenta de nuevo."
      );
    }
  }, []);

  useEffect(() => {
    doFetch().finally(() => setInitialLoad(false));
  }, [doFetch]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await doFetch();
    } finally {
      setRefreshing(false);
    }
  };

  // Destacar es directo; quitar SIEMPRE pasa por ConfirmModal (acción que
  // afecta la portada pública del directorio).
  const handleFeature = async (agency: MarketplaceAgencyShowcase) => {
    if (busyId || savingOrder) return;
    setBusyId(agency.id);
    try {
      await marketplaceAdminApi.updateShowcase(agency.id, {
        is_featured: true,
        featured_order: nextFeaturedPosition(agencies),
      });
      toast.success(`${agency.name} ahora es destacada`);
      await doFetch();
    } catch (err) {
      // Sin refetch: la lista local no cambió, se conserva el estado actual.
      toast.error(getApiErrorMessage(err, "No se pudo actualizar la agencia"));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmUnfeature = async () => {
    if (unfeatureRef.current || !unfeatureTarget) return;
    unfeatureRef.current = true;
    setUnfeatureLoading(true);
    try {
      // Solo `is_featured`: el backend resetea featured_order a 0, así que
      // una agencia no destacada jamás conserva un orden activo.
      await marketplaceAdminApi.updateShowcase(unfeatureTarget.id, {
        is_featured: false,
      });
      toast.success(`${unfeatureTarget.name} salió de destacadas`);
      setUnfeatureTarget(null);
      await doFetch();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, "No se pudo quitar la agencia de destacadas")
      );
    } finally {
      unfeatureRef.current = false;
      setUnfeatureLoading(false);
    }
  };

  const handleCancelUnfeature = () => {
    if (unfeatureLoading) return;
    setUnfeatureTarget(null);
  };

  const moveFeatured = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    // Prevención de valores inválidos: fuera de rango, no se mueve.
    if (target < 0 || target >= order.length) return;
    if (savingOrder || busyId) return;
    setOrder((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSaveOrder = async () => {
    if (savingOrder) return;

    const plan = buildFeaturedSavePlan(agencies, order);
    if (!plan.ok) {
      // El servidor cambió bajo el orden local (otra pestaña, refetch
      // fallido): en vez de persistir algo inválido se recarga.
      toast.error("El orden cambió en el servidor. Recargando…");
      await doFetch();
      return;
    }
    if (plan.patches.length === 0) return;

    setSavingOrder(true);
    try {
      await Promise.all(
        plan.patches.map(({ agencyId, featured_order }) =>
          marketplaceAdminApi.updateShowcase(agencyId, { featured_order })
        )
      );
      toast.success("Orden guardado");
      await doFetch();
    } catch (err) {
      // NO se revierte el orden local: se conserva hasta confirmación de
      // éxito para que el superadmin pueda reintentar (regla 11).
      toast.error(getApiErrorMessage(err, "No se pudo guardar el orden"));
    } finally {
      setSavingOrder(false);
    }
  };

  const scrollToAllAgencies = () => {
    const el = allListRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const dirty = isOrderDirty(order, agencies);
  const featuredOrdered = order
    .map((id) => agencies.find((agency) => agency.id === id))
    .filter((agency): agency is MarketplaceAgencyShowcase => Boolean(agency));
  const nonFeaturedCount = agencies.length - featuredOrdered.length;

  if (initialLoad) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <AdminSkeletonShell>
          <AdminSkeletonItem>
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-7 w-56 rounded-lg" />
              </div>
              <Skeleton className="h-10 w-40 rounded-xl" />
            </div>
          </AdminSkeletonItem>
          <AdminSkeletonItem>
            <div className="rounded-2xl border border-[rgba(0,0,0,0.06)] bg-[var(--color-brand-surface)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <Skeleton className="mb-5 h-4 w-52" />
              <div className="space-y-3">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            </div>
          </AdminSkeletonItem>
          <AdminSkeletonItem className="mt-8">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-36 rounded-2xl" />
              ))}
            </div>
          </AdminSkeletonItem>
        </AdminSkeletonShell>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader
          title="Agencias destacadas"        
          action={
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Actualizar lista"
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border-none bg-slate-100 text-[var(--color-brand-navy)] transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                  strokeWidth={1.75}
                />
              </button>
              <Button
                onClick={handleSaveOrder}
                loading={savingOrder}
                disabled={!dirty || savingOrder}
              >
                <Save className="w-4 h-4" strokeWidth={1.75} />
                Guardar orden
              </Button>
            </div>
          }
        />
      </motion.div>

      {/* Error de carga */}
      {fetchError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
        >
          <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
            {fetchError}
          </p>
          <Button variant="secondary" size="sm" onClick={doFetch}>
            Reintentar
          </Button>
        </motion.div>
      )}

      {/* Orden en el directorio (solo destacadas) */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <SectionTitle>Orden en el directorio</SectionTitle>
            <p className="mt-2 pl-4 text-xs text-[var(--color-brand-muted)]">
              {featuredOrdered.length} de {agencies.length} agencias destacadas
              · este es el orden que muestra el directorio público.
            </p>
          </div>
          {dirty && <Badge variant="warning">Cambios sin guardar</Badge>}
        </div>

        {featuredOrdered.length === 0 ? (
          <EmptyState
            icon={<Star className="w-8 h-8" />}
            message="Aún no hay agencias destacadas. Destaca agencias para que aparezcan primero en el directorio."
            action={
              nonFeaturedCount > 0
                ? { label: "Destacar una agencia", onClick: scrollToAllAgencies }
                : { label: "Ir a Agencias", href: "/admin/agencies" }
            }
          />
        ) : (
          <ol className="space-y-3">
            {featuredOrdered.map((agency, index) => (
              <li key={agency.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="count">{index + 1}</Badge>
                    <AgencyLogo agency={agency} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-[family-name:var(--font-heading)] font-bold text-[17px] leading-tight text-[var(--color-brand-navy)]">
                        {agency.name}
                      </p>
                      <p className="truncate text-xs text-[var(--color-brand-muted)]">
                        {agency.subdomain}
                      </p>
                    </div>
                    <FeaturedBadge />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Subir ${agency.name}`}
                        onClick={() => moveFeatured(index, -1)}
                        disabled={
                          index === 0 || savingOrder || busyId !== null
                        }
                        className={iconButtonClass}
                      >
                        <ChevronUp className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Bajar ${agency.name}`}
                        onClick={() => moveFeatured(index, 1)}
                        disabled={
                          index === featuredOrdered.length - 1 ||
                          savingOrder ||
                          busyId !== null
                        }
                        className={iconButtonClass}
                      >
                        <ChevronDown className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <Button
                        variant="destructive"
                        size="sm"
                        aria-label={`Quitar ${agency.name} del orden`}
                        onClick={() => setUnfeatureTarget(agency)}
                        disabled={savingOrder || busyId !== null}
                      >
                        Quitar
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </motion.section>

      {/* Listado completo de agencias activas */}
      <motion.section
        ref={allListRef}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
        className="mt-8"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>Agencias activas</SectionTitle>
          <p className="text-xs text-[var(--color-brand-muted)]">
            {agencies.length} agencias · {featuredOrdered.length} destacadas
          </p>
        </div>

        {agencies.length === 0 ? (
          <EmptyState
            icon={<Building2 className="w-8 h-8" />}
            message="No hay agencias activas en el directorio del Marketplace"
            action={{ label: "Ir a Agencias", href: "/admin/agencies" }}
          />
        ) : (
          <motion.div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
          >
            {agencies.map((agency) => (
              <motion.div key={agency.id} variants={staggerItem}>
                <Card hover className="flex h-full flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <AgencyLogo agency={agency} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-[family-name:var(--font-heading)] font-bold text-[17px] leading-tight text-[var(--color-brand-navy)]">
                        {agency.name}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-[var(--color-brand-muted)]">
                        {agency.subdomain}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {agency.is_featured ? (
                          <FeaturedBadge />
                        ) : (
                          <Badge variant="inactive" size="sm">
                            No destacada
                          </Badge>
                        )}
                        <Badge variant="inactive" size="xs">
                          {agency.is_featured
                            ? `Orden ${agency.featured_order}`
                            : "Sin orden"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    {agency.is_featured ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        aria-label={`Quitar ${agency.name} de destacadas`}
                        onClick={() => setUnfeatureTarget(agency)}
                        disabled={
                          savingOrder || (busyId !== null && busyId !== agency.id)
                        }
                      >
                        <StarOff className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Quitar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        aria-label={`Destacar ${agency.name}`}
                        onClick={() => handleFeature(agency)}
                        loading={busyId === agency.id}
                        disabled={
                          savingOrder || (busyId !== null && busyId !== agency.id)
                        }
                      >
                        <Star className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Destacar
                      </Button>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        )}
      </motion.section>

      {/* Confirmación: quitar de destacadas */}
      <ConfirmModal
        open={unfeatureTarget !== null}
        title="Quitar de destacadas"
        message={
          unfeatureTarget
            ? `${unfeatureTarget.name} dejará de aparecer primero en el directorio público y su orden se restablecerá.`
            : ""
        }
        confirmLabel="Quitar"
        cancelLabel="Cancelar"
        variant="danger"
        loading={unfeatureLoading}
        onConfirm={handleConfirmUnfeature}
        onCancel={handleCancelUnfeature}
      />
    </main>
  );
}
