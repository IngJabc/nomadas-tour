'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Building2,
  Landmark,
  Loader2,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
  Power,
  AlertTriangle,
} from 'lucide-react';
import { agencyApi } from '@/lib/api';
import { ApiError } from '@/lib/errors/api-error';
import {
  ACCOUNT_TYPE_LABELS,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type AgencyPagoMovilData,
  type AgencyPaymentMethod,
} from '@/lib/payments';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Modal } from '@/components/ui/Modal';

interface ChannelFormState {
  label: string;
  bank_code: string;
  bank_name: string;
  phone: string;
  document_type: '' | 'V' | 'E' | 'J' | 'G';
  document_number: string;
  holder_name: string;
  account_type: '' | 'checking' | 'savings';
  account_number: string;
}

type ChannelFormErrors = Partial<Record<keyof ChannelFormState, string>>;

const EMPTY_FORM: ChannelFormState = {
  label: '',
  bank_code: '',
  bank_name: '',
  phone: '',
  document_type: '',
  document_number: '',
  holder_name: '',
  account_type: '',
  account_number: '',
};

function validateChannelForm(form: ChannelFormState): ChannelFormErrors {
  const errors: ChannelFormErrors = {};
  if (!form.label.trim() || form.label.trim().length > 60) {
    errors.label = 'Indica un nombre corto (máx. 60 caracteres).';
  }
  if (!/^\d{4}$/.test(form.bank_code.trim())) {
    errors.bank_code = 'El código del banco debe tener 4 dígitos.';
  }
  if (!form.bank_name.trim() || form.bank_name.trim().length > 80) {
    errors.bank_name = 'Indica el nombre del banco (máx. 80 caracteres).';
  }
  if (!/^04\d{9}$/.test(form.phone.trim())) {
    errors.phone = 'Usa el formato 04XXXXXXXXX.';
  }
  if (!form.document_type) {
    errors.document_type = 'Selecciona el tipo de documento.';
  }
  if (!/^\d{6,9}$/.test(form.document_number.trim())) {
    errors.document_number = 'El documento debe tener entre 6 y 9 dígitos.';
  }
  if (!form.holder_name.trim() || form.holder_name.trim().length > 120) {
    errors.holder_name = 'Indica el titular de la cuenta (máx. 120 caracteres).';
  }
  if (form.account_number.trim() && !/^\d{1,30}$/.test(form.account_number.trim())) {
    errors.account_number = 'La cuenta debe contener solo dígitos.';
  }
  return errors;
}

function toPagoMovilData(form: ChannelFormState): AgencyPagoMovilData {
  const data: AgencyPagoMovilData = {
    bank_code: form.bank_code.trim(),
    bank_name: form.bank_name.trim(),
    phone: form.phone.trim(),
    document_type: form.document_type as AgencyPagoMovilData['document_type'],
    document_number: form.document_number.trim(),
    holder_name: form.holder_name.trim(),
  };
  if (form.account_type) {
    data.account_type = form.account_type as AgencyPagoMovilData['account_type'];
  }
  if (form.account_number.trim()) {
    data.account_number = form.account_number.trim();
  }
  return data;
}

function formFromMethod(method: AgencyPaymentMethod): ChannelFormState {
  const data = (method.data ?? {}) as Partial<AgencyPagoMovilData>;
  return {
    label: method.label ?? '',
    bank_code: data.bank_code ?? '',
    bank_name: data.bank_name ?? '',
    phone: data.phone ?? '',
    document_type: (data.document_type as ChannelFormState['document_type']) ?? '',
    document_number: data.document_number ?? '',
    holder_name: data.holder_name ?? '',
    account_type: (data.account_type as ChannelFormState['account_type']) ?? '',
    account_number: data.account_number ?? '',
  };
}

function describeData(method: AgencyPaymentMethod): string[] {
  const data = (method.data ?? {}) as Partial<AgencyPagoMovilData>;
  const lines: string[] = [];
  if (data.bank_name || data.bank_code) {
    lines.push(`${data.bank_name ?? ''}${data.bank_code ? ` (${data.bank_code})` : ''}`.trim());
  }
  if (data.phone) lines.push(`Teléfono ${data.phone}`);
  if (data.holder_name) {
    const doc = data.document_type && data.document_number
      ? `${data.document_type}-${data.document_number}`
      : '';
    lines.push(`${data.holder_name}${doc ? ` · ${doc}` : ''}`);
  }
  if (data.account_type || data.account_number) {
    const type = data.account_type ? ACCOUNT_TYPE_LABELS[data.account_type] ?? data.account_type : '';
    lines.push([type, data.account_number].filter(Boolean).join(' · '));
  }
  return lines.filter(Boolean);
}

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}

export default function AgencyPaymentMethodsSettingsPage() {
  const [methods, setMethods] = useState<AgencyPaymentMethod[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgencyPaymentMethod | null>(null);
  const [form, setForm] = useState<ChannelFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<ChannelFormErrors>({});
  const [saving, setSaving] = useState(false);

  const [rowActionId, setRowActionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AgencyPaymentMethod | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await agencyApi.listPaymentMethods();
      setMethods(result.methods);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (method: AgencyPaymentMethod) => {
    setEditing(method);
    setForm(formFromMethod(method));
    setFormErrors({});
    setFormOpen(true);
  };

  const updateField = <K extends keyof ChannelFormState>(
    key: K,
    value: ChannelFormState[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => ({ ...current, [key]: undefined }));
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const errors = validateChannelForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error('Revisa los datos del método de pago');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await agencyApi.updatePaymentMethod(editing.id, {
          label: form.label.trim(),
          data: toPagoMovilData(form),
        });
        toast.success('Método de pago actualizado');
      } else {
        await agencyApi.createPaymentMethod({
          method: 'pago_movil',
          label: form.label.trim(),
          data: toPagoMovilData(form),
          is_primary: false,
        });
        toast.success('Método de pago creado');
      }
      setFormOpen(false);
      await load();
    } catch (error) {
      toast.error(apiMessage(error, 'No se pudo guardar el método de pago'));
    } finally {
      setSaving(false);
    }
  };

  const runRowAction = async (
    method: AgencyPaymentMethod,
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    if (rowActionId) return;
    setRowActionId(method.id);
    try {
      await action();
      toast.success(successMessage);
      await load();
    } catch (error) {
      toast.error(apiMessage(error, 'No se pudo actualizar el método de pago'));
    } finally {
      setRowActionId(null);
    }
  };

  const handleSetPrimary = (method: AgencyPaymentMethod) =>
    runRowAction(
      method,
      () => agencyApi.setPaymentMethodPrimary(method.id),
      'Método principal actualizado',
    );

  const handleToggleActive = (method: AgencyPaymentMethod) =>
    runRowAction(
      method,
      () => agencyApi.updatePaymentMethod(method.id, { is_active: !method.is_active }),
        method.is_active ? 'Método desactivado' : 'Método activado',
    );

  const handleConfirmDelete = async () => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    try {
      await agencyApi.deletePaymentMethod(confirmDelete.id);
      toast.success('Método de pago eliminado');
      setConfirmDelete(null);
      await load();
    } catch (error) {
      toast.error(apiMessage(error, 'No se pudo eliminar el método de pago'));
    } finally {
      setDeleting(false);
    }
  };

  const activeCount = (methods ?? []).filter((m) => m.is_active).length;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader title="Métodos de pago" />

      <div className="mb-6">
        <SectionTitle>Cómo te pagan tus clientes</SectionTitle>
        <p className="mt-3 max-w-3xl font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
          Estos datos se muestran a los clientes del marketplace antes de que
          suban su comprobante de pago móvil. La aprobación de cada compra
          ocurre siempre desde la revisión de compras de tu panel.
        </p>
      </div>

      <Card className="mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="w-5 h-5 text-[#f59e0b] shrink-0 mt-0.5"
            strokeWidth={1.75}
          />
          <div>
            <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)]">
              {activeCount === 0
                ? 'Sin métodos activos no se pueden iniciar compras'
                : 'Recuerda confirmar cada pago desde tu panel'}
            </p>
            <p className="mt-1 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
              {activeCount === 0
                ? 'Los clientes del marketplace no podrán iniciar una compra hasta que actives al menos un método de pago. Puedes atender dudas por WhatsApp al teléfono de tu agencia; el envío de un comprobante por WhatsApp no confirma la reserva.'
                : 'Si un cliente te envía su comprobante por WhatsApp, indícale que la confirmación se hace al aprobarlo en tu panel de Pagos. Enviar el comprobante únicamente por WhatsApp no confirma la reserva.'}
            </p>
          </div>
        </div>
      </Card>

      <div className="flex justify-end mb-4">
        <Button onClick={openCreate} disabled={loading || !!loadError}>
          <Plus className="w-4 h-4" strokeWidth={1.75} />
          Agregar método de pago
        </Button>
      </div>

      {loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      )}

      {!loading && loadError && (
        <Card className="flex flex-col items-start gap-4">
          <div className="flex items-center gap-3 text-[#ef4444]">
            <Landmark className="w-5 h-5" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm">
              No se pudieron cargar los métodos de pago. Intenta de nuevo.
            </p>
          </div>
          <Button variant="secondary" onClick={load}>
            Reintentar
          </Button>
        </Card>
      )}

      {!loading && !loadError && methods && methods.length === 0 && (
        <EmptyState
          icon={<Landmark className="w-8 h-8" strokeWidth={1.75} />}
          message="Todavía no tienes métodos de pago. Agrega tu cuenta de pago móvil para que tus clientes del marketplace puedan iniciar compras."
          action={{ label: 'Agregar método de pago', onClick: openCreate }}
        />
      )}

      {!loading && !loadError && methods && methods.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {methods.map((method) => {
            const busy = rowActionId === method.id;
            const methodLabel = PAYMENT_METHOD_LABELS[method.method] ?? method.method;
            return (
              <Card key={method.id}>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)] truncate">
                        {method.label}
                      </h2>
                      {method.is_primary && (
                        <Badge variant="info">Principal</Badge>
                      )}
                      {!method.is_active && (
                        <Badge variant="inactive">Inactivo</Badge>
                      )}
                    </div>
                    <p className="mt-1 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                      {methodLabel}
                    </p>
                  </div>
                  <Landmark
                    className="w-5 h-5 text-[var(--color-brand-muted)] shrink-0"
                    strokeWidth={1.75}
                  />
                </div>

                <ul className="space-y-2 mb-6">
                  {describeData(method).map((line, index) => (
                    <li
                      key={index}
                      className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] flex items-start gap-2"
                    >
                      {index === 0 ? (
                        <Building2 className="w-4 h-4 mt-0.5 text-[var(--color-brand-muted)] shrink-0" strokeWidth={1.75} />
                      ) : index === 1 ? (
                        <Phone className="w-4 h-4 mt-0.5 text-[var(--color-brand-muted)] shrink-0" strokeWidth={1.75} />
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEdit(method)}
                    disabled={busy}
                  >
                    <Pencil className="w-4 h-4" strokeWidth={1.75} />
                    Editar
                  </Button>
                  {!method.is_primary && method.is_active && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleSetPrimary(method)}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Star className="w-4 h-4" strokeWidth={1.75} />
                      )}
                      Hacer principal
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleToggleActive(method)}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Power className="w-4 h-4" strokeWidth={1.75} />
                    )}
                    {method.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmDelete(method)}
                    disabled={busy}
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                    Eliminar
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="md"
        titleId="payment-method-form-title"
      >
        <form onSubmit={handleSave} className="p-6">
          <p
            id="payment-method-form-title"
            className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)] mb-1"
          >
            {editing ? 'Editar método de pago' : 'Nuevo método de pago'}
          </p>
          <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)] mb-6">
            Estos datos los verá el cliente del marketplace antes de subir su
            comprobante de pago móvil.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input
                label="Nombre del método"
                placeholder="Ej. Pago móvil Banesco"
                value={form.label}
                onChange={(e) => updateField('label', e.target.value)}
                error={formErrors.label}
                disabled={saving}
                maxLength={60}
              />
            </div>
            <Input
              label="Código del banco"
              placeholder="4 dígitos"
              inputMode="numeric"
              value={form.bank_code}
              onChange={(e) => updateField('bank_code', e.target.value)}
              error={formErrors.bank_code}
              disabled={saving}
              maxLength={4}
            />
            <Input
              label="Banco"
              placeholder="Ej. Banesco"
              value={form.bank_name}
              onChange={(e) => updateField('bank_name', e.target.value)}
              error={formErrors.bank_name}
              disabled={saving}
              maxLength={80}
            />
            <Input
              label="Teléfono (cuenta)"
              placeholder="04121234567"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              error={formErrors.phone}
              disabled={saving}
              maxLength={12}
              helperText="Número asociado a la cuenta de pago móvil."
            />
            <Input
              label="Titular de la cuenta"
              placeholder="Nombre y apellido"
              value={form.holder_name}
              onChange={(e) => updateField('holder_name', e.target.value)}
              error={formErrors.holder_name}
              disabled={saving}
              maxLength={120}
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="document-type"
                className="font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider"
              >
                Tipo de documento
              </label>
              <select
                id="document-type"
                value={form.document_type}
                onChange={(e) =>
                  updateField('document_type', e.target.value as ChannelFormState['document_type'])
                }
                disabled={saving}
                className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-4 py-3 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] disabled:opacity-40"
              >
                <option value="">Selecciona</option>
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {formErrors.document_type && (
                <p className="font-[family-name:var(--font-body)] text-[12px] text-[#ef4444]">
                  {formErrors.document_type}
                </p>
              )}
            </div>
            <Input
              label="Número de documento"
              placeholder="6 a 9 dígitos"
              inputMode="numeric"
              value={form.document_number}
              onChange={(e) => updateField('document_number', e.target.value)}
              error={formErrors.document_number}
              disabled={saving}
              maxLength={9}
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="account-type"
                className="font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider"
              >
                Tipo de cuenta (opcional)
              </label>
              <select
                id="account-type"
                value={form.account_type}
                onChange={(e) =>
                  updateField('account_type', e.target.value as ChannelFormState['account_type'])
                }
                disabled={saving}
                className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-4 py-3 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] disabled:opacity-40"
              >
                <option value="">No indicar</option>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Número de cuenta (opcional)"
              placeholder="Solo dígitos"
              inputMode="numeric"
              value={form.account_number}
              onChange={(e) => updateField('account_number', e.target.value)}
              error={formErrors.account_number}
              disabled={saving}
              maxLength={30}
            />
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
                {editing ? 'Guardar cambios' : 'Crear método'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!confirmDelete}
        title="¿Eliminar este método de pago?"
        message={
          confirmDelete
            ? `El método "${confirmDelete.label}" dejará de mostrarse en el marketplace. Las compras que ya eligieron este método conservan su información.`
            : ''
        }
        confirmLabel="Eliminar método"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}
