'use client';

import { useEffect, useState } from 'react';
import { Mail, Copy } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export default function AdminInvitationsPage() {
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchData = async () => {
    try {
      const data = await adminApi.listInvitations();
      setInvitations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar invitaciones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const inv = await adminApi.createInvitation();
      setNewLink(inv.link);
      setCopied(false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear invitación');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = () => {
    if (!newLink) return;
    const fullUrl = `${window.location.origin}${newLink}`;
    navigator.clipboard.writeText(fullUrl).then(() => setCopied(true));
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader
        title="Invitaciones"
        action={
          <Button onClick={handleCreate} loading={creating}>
            + Nueva invitación
          </Button>
        }
      />

      {error && (
        <p className="mb-4 font-['Poppins',sans-serif] text-[13px] text-red-500">{error}</p>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-[var(--color-brand-surface)] rounded-2xl p-6 animate-pulse border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <div className="h-5 w-48 bg-slate-200 rounded mb-3" />
              <div className="h-4 w-32 bg-[var(--color-page-bg)] rounded" />
            </div>
          ))}
        </div>
      ) : invitations.length === 0 ? (
        <EmptyState
          icon={<Mail className="w-8 h-8" />}
          message="No hay invitaciones creadas"
          action={{ label: 'Crear primera invitación', onClick: handleCreate }}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Token</th>
                    <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Creada</th>
                    <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Expira</th>
                    <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Estado</th>
                    <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Usada por</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv: any) => {
                    const isExpired = !inv.used_at && new Date(inv.expires_at) < new Date();
                    const isUsed = !!inv.used_at;
                    let statusLabel: string;
                    let pillClass: string;
                    if (isUsed) {
                      statusLabel = 'Usada';
                      pillClass = 'bg-slate-100 text-brand-muted';
                    } else if (isExpired) {
                      statusLabel = 'Expirada';
                      pillClass = 'bg-red-50 text-red-500';
                    } else {
                      statusLabel = 'Pendiente';
                      pillClass = 'bg-emerald-50 text-emerald-600';
                    }
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50 transition-colors border-b border-slate-100">
                        <td className="px-5 py-4 font-['Poppins',sans-serif] font-medium text-sm text-brand-navy whitespace-nowrap">
                          <code className="bg-slate-100 px-2 py-0.5 rounded text-[12px]">{inv.token.slice(0, 16)}...</code>
                        </td>
                        <td className="px-5 py-4 font-['Poppins',sans-serif] font-normal text-sm text-brand-muted whitespace-nowrap">{formatDate(inv.created_at)}</td>
                        <td className="px-5 py-4 font-['Poppins',sans-serif] font-normal text-sm text-brand-muted whitespace-nowrap">{formatDate(inv.expires_at)}</td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <span className={`inline-block font-['Poppins',sans-serif] font-semibold text-[11px] px-[10px] py-[3px] rounded-full ${pillClass}`}>{statusLabel}</span>
                        </td>
                        <td className="px-5 py-4 font-['Poppins',sans-serif] font-normal text-sm text-brand-muted whitespace-nowrap">{inv.used_by || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {invitations.map((inv: any) => {
              const isExpired = !inv.used_at && new Date(inv.expires_at) < new Date();
              const isUsed = !!inv.used_at;
              let statusLabel: string;
              let pillClass: string;
              if (isUsed) {
                statusLabel = 'Usada';
                pillClass = 'bg-slate-100 text-brand-muted';
              } else if (isExpired) {
                statusLabel = 'Expirada';
                pillClass = 'bg-red-50 text-red-500';
              } else {
                statusLabel = 'Pendiente';
                pillClass = 'bg-emerald-50 text-emerald-600';
              }
              return (
                <div key={inv.id} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <code className="font-['Poppins',sans-serif] text-sm text-brand-navy bg-slate-100 px-2 py-0.5 rounded">{inv.token.slice(0, 16)}...</code>
                    </div>
                    <span className={`font-['Poppins',sans-serif] font-semibold text-[11px] px-[10px] py-[3px] rounded-full ${pillClass}`}>{statusLabel}</span>
                  </div>
                  <div className="font-['Poppins',sans-serif] text-xs text-brand-muted space-y-0.5">
                    <p>Creada: {formatDate(inv.created_at)}</p>
                    <p>Expira: {formatDate(inv.expires_at)}</p>
                    {inv.used_by && <p>Usada por: {inv.used_by}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal with the invite link */}
      {newLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setNewLink(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200/60 p-6 w-full max-w-md">
            <h3 className="font-['Montserrat',sans-serif] font-bold text-lg text-brand-navy mb-2">
              Invitación creada
            </h3>
            <p className="font-['Poppins',sans-serif] text-sm text-brand-muted mb-4">
              Comparte este enlace con la agencia para que se registre:
            </p>
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl border border-slate-200 px-3 py-2.5 mb-5">
              <code className="flex-1 font-['Poppins',sans-serif] text-sm text-brand-navy break-all select-all">
                {typeof window !== 'undefined' ? `${window.location.origin}${newLink}` : newLink}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-xs border-none cursor-pointer hover:bg-brand-blue transition-colors"
              >
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setNewLink(null)}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-brand-cyan rounded-xl hover:bg-brand-blue transition-colors border-none cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
