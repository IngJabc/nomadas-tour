'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Plus, CheckCircle, XCircle, Copy, Search, X } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/form';
import { CardSkeleton } from '@/components/ui/Skeleton';

const STATUS_STYLES: Record<string, { label: string; variant: 'active' | 'inactive' | 'warning' }> = {
  active: { label: 'Activa', variant: 'active' },
  inactive: { label: 'Inactiva', variant: 'inactive' },
  pending: { label: 'Pendiente', variant: 'warning' },
};

export default function AdminAgenciesPage() {
  const [agencies, setAgencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editAgency, setEditAgency] = useState<any | null>(null);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formStatus, setFormStatus] = useState('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteAgency, setDeleteAgency] = useState<any | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [newAgencyLink, setNewAgencyLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const filteredAgencies = searchInput.trim()
    ? agencies.filter((a) =>
        a.name.toLowerCase().includes(searchInput.toLowerCase()) ||
        (a.email && a.email.toLowerCase().includes(searchInput.toLowerCase()))
      )
    : agencies;

  const fetchData = async () => {
    try {
      const data = await adminApi.listAgencies();
      setAgencies(data);
    } catch {
      setAgencies([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreate = () => {
    setEditAgency(null);
    setFormName('');
    setFormEmail('');
    setFormStatus('active');
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (agency: any) => {
    setEditAgency(agency);
    setFormName(agency.name);
    setFormStatus(agency.status);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError('El nombre es requerido');
      return;
    }
    if (!editAgency && !formEmail.trim()) {
      setFormError('El correo electrónico es requerido');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editAgency) {
        await adminApi.updateAgency(editAgency.id, { name: formName.trim(), status: formStatus });
        setModalOpen(false);
      } else {
        const result = await adminApi.createAgency({ name: formName.trim(), email: formEmail.trim() });
        setModalOpen(false);
        setNewAgencyLink(result.invitation_link);
        setCopied(false);
      }
      await fetchData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteAgency) return;
    const newStatus = deleteAgency.status === 'active' ? 'inactive' : 'active';
    try {
      await adminApi.updateAgency(deleteAgency.id, { status: newStatus });
      setDeleteAgency(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cambiar estado de la agencia');
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader
        title="Agencias"
        action={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" />
            Nueva agencia
          </Button>
        }
      />

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 font-[family-name:var(--font-body)] text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : agencies.length === 0 ? (
        <EmptyState
          icon={<Building2 className="w-8 h-8" />}
          message="No hay agencias registradas"
          action={{ label: 'Crear primera agencia', onClick: openCreate }}
        />
      ) : (
        <>
          {/* Search filter */}
          <div className="mb-6">
            <div className="relative w-full max-w-xl">
              <input
                type="text"
                placeholder="Buscar agencia por nombre o correo..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full h-9 border-[1.5px] border-[#e5e7eb] rounded-xl pl-8 pr-8 text-xs sm:text-sm font-[family-name:var(--font-body)] font-semibold text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)]"
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-brand-muted)]" />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {filteredAgencies.length === 0 ? (
            <EmptyState
              icon={<Building2 className="w-8 h-8" />}
              message="No se encontraron agencias con ese criterio de búsqueda"
            />
          ) : (
            <div className="bg-[var(--color-brand-surface)] rounded-2xl overflow-hidden border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc]">
                      <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">Nombre</th>
                      <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">Subdominio</th>
                      <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">Estado</th>
                      <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAgencies.map((agency: any) => {
                      const s = STATUS_STYLES[agency.status] ?? STATUS_STYLES.active;
                      return (
                        <tr key={agency.id} className="hover:bg-[#f8fafc] transition-colors border-b border-[rgba(0,0,0,0.06)]">
                          <td className="px-5 py-4 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)] whitespace-nowrap">{agency.name}</td>
                          <td className="px-5 py-4 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-muted)] whitespace-nowrap">{agency.subdomain}</td>
                          <td className="px-5 py-4 whitespace-nowrap">
                            <Badge variant={s.variant} size="sm">{s.label}</Badge>
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap">
                            <div className="flex gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => openEdit(agency)}
                              >
                                Editar
                              </Button>
                              <Button
                                variant={agency.status === 'inactive' ? 'secondary' : 'destructive'}
                                size="sm"
                                onClick={() => setDeleteAgency(agency)}
                              >
                                {agency.status === 'inactive' ? 'Activar' : 'Desactivar'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="relative bg-[var(--color-brand-surface)] rounded-2xl shadow-xl border border-[rgba(0,0,0,0.06)] p-6 w-full max-w-md">
            <h3 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)] mb-4">
              {editAgency ? 'Editar agencia' : 'Nueva agencia'}
            </h3>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-[#fef2f2] border border-[#fee2e2] font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
                {formError}
              </div>
            )}

            <div className="space-y-4 mb-5">
              <Field label="Nombre">
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ej. Agencia Central"
                  className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-[var(--color-brand-surface)] outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
                />
              </Field>
              {!editAgency && (
                <Field label="Correo del administrador">
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="admin@agencia.com"
                    className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-[var(--color-brand-surface)] outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
                  />
                </Field>
              )}
              {editAgency && (
                <Field label="Estado">
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-[var(--color-brand-surface)] outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
                  >
                    <option value="active">Activa</option>
                    <option value="inactive">Inactiva</option>
                    <option value="pending">Pendiente</option>
                  </select>
                </Field>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setModalOpen(false)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                loading={saving}
                className="flex-1"
              >
                {editAgency ? 'Actualizar' : 'Crear'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Invitation link modal */}
      {newAgencyLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNewAgencyLink(null)} />
          <div className="relative bg-[var(--color-brand-surface)] rounded-2xl shadow-xl border border-[rgba(0,0,0,0.06)] p-6 w-full max-w-md">
            <h3 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)] mb-2">
              Agencia creada
            </h3>
            <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)] mb-4">
              Comparte este enlace con el administrador de la agencia para que complete el registro:
            </p>
            <div className="flex items-center gap-2 bg-[#f8fafc] rounded-xl border border-[rgba(0,0,0,0.06)] px-3 py-2.5 mb-5">
              <code className="flex-1 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] break-all select-all">
                {typeof window !== 'undefined' ? `${window.location.origin}${newAgencyLink}` : newAgencyLink}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const fullUrl = `${window.location.origin}${newAgencyLink}`;
                  navigator.clipboard.writeText(fullUrl).then(() => setCopied(true));
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <Button onClick={() => setNewAgencyLink(null)} className="w-full">
              Cerrar
            </Button>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {deleteAgency && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteAgency(null)} />
          <div className="relative bg-[var(--color-brand-surface)] rounded-2xl shadow-xl border border-[rgba(0,0,0,0.06)] p-6 w-full max-w-sm text-center">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4 ${
              deleteAgency.status === 'inactive' ? 'bg-emerald-50' : 'bg-[#fef2f2]'
            }`}>
              {deleteAgency.status === 'inactive'
                ? <CheckCircle className="w-5 h-5 text-emerald-400" />
                : <XCircle className="w-5 h-5 text-red-400" />
              }
            </div>
            <h3 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)] mb-2">
              {deleteAgency.status === 'inactive' ? 'Activar agencia' : 'Desactivar agencia'}
            </h3>
            <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)] mb-6">
              {deleteAgency.status === 'inactive'
                ? '¿Estás seguro de activar esta agencia? Los usuarios podrán acceder nuevamente.'
                : '¿Estás seguro de desactivar esta agencia? Los viajes asignados no se verán afectados.'}
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setDeleteAgency(null)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="flex-1"
              >
                {deleteAgency.status === 'inactive' ? 'Activar' : 'Desactivar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
