"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Building2, Search, X, Plus, Copy } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { AgencyCard, AgencyFormModal } from "@/components/admin/agencies";
import type { AgencyData } from "@/components/admin/agencies";
import { adminApi } from "@/lib/api";
import { subscribeToAgencies } from "@/lib/realtime/subscriptions";
import { pageFade, staggerContainer, staggerItem } from "@/lib/motion/variants";

const STATUS_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "active", label: "Activas" },
  { value: "pending", label: "Pendientes" },
  { value: "inactive", label: "Inactivas" },
] as const;

export default function AdminAgenciesPage() {
  const [agencies, setAgencies] = useState<AgencyData[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingAgency, setEditingAgency] = useState<AgencyData | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<AgencyData | null>(
    null
  );
  const [deactivateLoading, setDeactivateLoading] = useState(false);

  const [newAgencyLink, setNewAgencyLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const doFetch = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await adminApi.listAgencies();
      setAgencies(data || []);
    } catch {
      setAgencies([]);
      setFetchError("No se pudieron cargar las agencias. Intenta de nuevo.");
    }
  }, []);

  const doFetchRef = useRef(doFetch);
  doFetchRef.current = doFetch;

  useEffect(() => {
    doFetch().finally(() => setInitialLoad(false));
  }, [doFetch]);

  // Realtime: agencies INSERT and UPDATE → refetch for computed fields
  useEffect(() => {
    const debounceTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    const handleAgencyEvent = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        doFetchRef.current();
      }, 500);
    };

    const cleanup = subscribeToAgencies(handleAgencyEvent);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanup();
    };
  }, []);

  const filteredAgencies = useMemo(() => {
    let result = agencies;

    if (statusFilter) {
      result = result.filter((a) => a.status === statusFilter);
    }

    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.email && a.email.toLowerCase().includes(q))
      );
    }

    return result;
  }, [agencies, statusFilter, searchFilter]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchFilter(value), 300);
  };

  const handleEnter = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchFilter(searchInput);
  };

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInput("");
    setSearchFilter("");
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleOpenCreate = () => {
    setFormMode("create");
    setEditingAgency(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (agency: AgencyData) => {
    setFormMode("edit");
    setEditingAgency(agency);
    setFormOpen(true);
  };

  const handleFormSubmit = async (data: { name: string; email?: string }) => {
    if (formMode === "create") {
      const result = await adminApi.createAgency(
        data as { name: string; email: string }
      );
      toast.success("Agencia creada correctamente");
      setFormOpen(false);
      setNewAgencyLink(result.invitation_link);
      setCopied(false);
    } else if (editingAgency) {
      await adminApi.updateAgency(editingAgency.id, { name: data.name });
      toast.success("Agencia actualizada correctamente");
    }
    await doFetch();
  };

  const handleOpenDeactivate = (agency: AgencyData) => {
    setDeactivateTarget(agency);
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivateLoading(true);
    try {
      await adminApi.updateAgency(deactivateTarget.id, { status: "inactive" });
      toast.success("Agencia desactivada");
      setDeactivateTarget(null);
      await doFetch();
    } catch {
      toast.error("No se pudo desactivar la agencia");
    } finally {
      setDeactivateLoading(false);
    }
  };

  const handleActivate = async (agency: AgencyData) => {
    try {
      await adminApi.updateAgency(agency.id, { status: "active" });
      toast.success("Agencia activada");
      await doFetch();
    } catch {
      toast.error("No se pudo activar la agencia");
    }
  };

  if (initialLoad) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="h-8 w-32 bg-slate-200 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
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
          title="Agencias"
          action={
            <Button onClick={handleOpenCreate}>
              <Plus className="w-4 h-4" />
              Nueva agencia
            </Button>
          }
        />
      </motion.div>

      {/* Filters */}
      <motion.div
        className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6"
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <div className="flex items-center gap-1.5 bg-[var(--color-brand-surface)] rounded-xl h-9 px-1 border border-[rgba(0,0,0,0.06)] shrink-0">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-[family-name:var(--font-body)] font-medium transition-colors ${
                statusFilter === opt.value
                  ? "bg-[var(--color-brand-cyan)] text-white"
                  : "text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            placeholder="Buscar por nombre o correo..."
            value={searchInput}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleEnter()}
            className="w-full h-10 border-[1.5px] border-[#e5e7eb] rounded-xl pl-8 pr-8 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all duration-200"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-brand-muted)]" />
          <AnimatePresence>
            {searchFilter && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors duration-150"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
        {(statusFilter || searchFilter) && (
          <motion.button
            initial={{ opacity: 0, width: 0, scaleX: 0 }}
            animate={{ opacity: 1, width: 'auto', scaleX: 1 }}
            exit={{ opacity: 0, width: 0, scaleX: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            type="button"
            onClick={() => {
              setSearchInput("");
              setSearchFilter("");
              setStatusFilter("");
            }}
            className="shrink-0 h-10 px-3 rounded-xl border border-[1.5px] border-[#e5e7eb] bg-white text-[var(--color-brand-muted)] hover:text-[#ef4444] hover:border-[#ef4444] transition-colors duration-150 flex items-center gap-1.5 text-xs font-[family-name:var(--font-body)] font-medium overflow-hidden origin-left"
          >
            <X className="w-3.5 h-3.5" />
            Limpiar
          </motion.button>
        )}
        </AnimatePresence>
      </motion.div>

      {/* Error */}
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

      {/* Content */}
      {agencies.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
        >
          <EmptyState
            icon={<Building2 className="w-8 h-8" />}
            message="No hay agencias registradas"
            action={{
              label: "Crear primera agencia",
              onClick: handleOpenCreate,
            }}
          />
        </motion.div>
      ) : filteredAgencies.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
        >
          <EmptyState
            icon={<Search className="w-8 h-8" />}
            message="No se encontraron agencias con ese criterio de búsqueda"
            action={{ label: "Limpiar búsqueda", onClick: clearSearch }}
          />
        </motion.div>
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {filteredAgencies.map((agency) => (
            <motion.div key={agency.id} variants={staggerItem}>
              <AgencyCard
                agency={agency}
                onEdit={handleOpenEdit}
                onDeactivate={handleOpenDeactivate}
                onActivate={handleActivate}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Form Modal */}
      <AgencyFormModal
        open={formOpen}
        mode={formMode}
        agency={editingAgency}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />

      {/* Deactivate Confirmation */}
      <ConfirmModal
        open={deactivateTarget !== null}
        title="Desactivar agencia"
        message={`¿Estás seguro de desactivar la agencia "${deactivateTarget?.name}"? Los usuarios de esta agencia no podrán acceder al sistema.`}
        confirmLabel="Desactivar"
        cancelLabel="Cancelar"
        variant="danger"
        loading={deactivateLoading}
        onConfirm={handleConfirmDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />

      {/* Invitation Link Modal */}
      <Modal open={!!newAgencyLink} onClose={() => setNewAgencyLink(null)} size="sm">
        <ModalHeader>
          <h3 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)]">
            Agencia creada
          </h3>
        </ModalHeader>
        <ModalBody>
          <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)] mb-4">
            Comparte este enlace con la agencia para que complete el registro:
          </p>
          <div className="flex items-center gap-2 bg-[#f8fafc] rounded-xl border border-[rgba(0,0,0,0.06)] px-3 py-2.5">
            <code className="flex-1 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] break-all select-all">
              {typeof window !== "undefined"
                ? `${window.location.origin}${newAgencyLink}`
                : newAgencyLink}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const fullUrl = `${window.location.origin}${newAgencyLink}`;
                navigator.clipboard
                  .writeText(fullUrl)
                  .then(() => setCopied(true));
              }}
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </ModalBody>
        <ModalFooter>
          <div />
          <Button onClick={() => setNewAgencyLink(null)}>
            Cerrar
          </Button>
        </ModalFooter>
      </Modal>
    </main>
  );
}
