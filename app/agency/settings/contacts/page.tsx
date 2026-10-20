'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  Power,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { agencyApi } from '@/lib/api';
import { ApiError } from '@/lib/errors/api-error';
import {
  CONTACT_CHANNEL_LABELS,
  filterContactLabel,
  filterPhoneInput,
  isValidPhone,
  normalizePhone,
  PHONE_FORMAT_MESSAGE,
  PHONE_MAX_LENGTH,
  type AgencyContact,
  type AgencyContactChannel,
} from '@/lib/contacts';
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

interface ContactFormState {
  label: string;
  phone: string;
  channel: '' | AgencyContactChannel;
  visibility: 'public' | 'private';
  sort_order: string;
}

type ContactFormErrors = Partial<Record<keyof ContactFormState, string>>;

const EMPTY_FORM: ContactFormState = {
  label: '',
  phone: '',
  channel: '',
  visibility: 'private',
  sort_order: '0',
};

function validateContactForm(form: ContactFormState): ContactFormErrors {
  const errors: ContactFormErrors = {};
  if (!form.label.trim() || form.label.trim().length > 60) {
    errors.label = 'Indica un nombre corto (máx. 60 caracteres).';
  }
  if (!isValidPhone(form.phone)) {
    errors.phone = `${PHONE_FORMAT_MESSAGE}.`;
  }
  if (!form.channel) {
    errors.channel = 'Selecciona el canal del contacto.';
  }
  if (form.sort_order.trim()) {
    const raw = form.sort_order.trim();
    // Alineado con el contrato del backend (Zod: int 0..1000).
    if (!/^\d+$/.test(raw) || Number(raw) > 1000) {
      errors.sort_order = 'El orden debe ser un número entero entre 0 y 1000.';
    }
  }
  return errors;
}

/** Solo dígitos mientras se escribe (el rango 0..1000 se valida en vivo). */
function filterSortOrderInput(value: string): string {
  return value.replace(/\D/g, '');
}

function formFromContact(contact: AgencyContact): ContactFormState {
  return {
    label: contact.label ?? '',
    phone: contact.phone ?? '',
    channel: contact.channel,
    visibility: contact.is_public ? 'public' : 'private',
    sort_order: String(contact.sort_order ?? 0),
  };
}

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}

export default function AgencyContactsSettingsPage() {
  const [contacts, setContacts] = useState<AgencyContact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgencyContact | null>(null);
  const [form, setForm] = useState<ContactFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<ContactFormErrors>({});
  const [saving, setSaving] = useState(false);

  const [rowActionId, setRowActionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AgencyContact | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await agencyApi.listContacts();
      setContacts(result.contacts);
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

  const openEdit = (contact: AgencyContact) => {
    setEditing(contact);
    setForm(formFromContact(contact));
    setFormErrors({});
    setFormOpen(true);
  };

  const updateField = <K extends keyof ContactFormState>(
    key: K,
    value: ContactFormState[K],
  ) => {
    const next = { ...form, [key]: value };
    setForm(next);
    // Feedback en vivo: si el campo ya mostraba error, re-validar al
    // cambiar; si no, limpiar (sin quejarse mientras se escribe).
    const fieldError = formErrors[key]
      ? validateContactForm(next)[key]
      : undefined;
    setFormErrors((current) => ({ ...current, [key]: fieldError }));
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const errors = validateContactForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error('Revisa los datos del contacto');
      return;
    }

    const payload = {
      label: form.label.trim(),
      phone: normalizePhone(form.phone),
      channel: form.channel as AgencyContactChannel,
      is_public: form.visibility === 'public',
      sort_order: form.sort_order.trim() ? Number(form.sort_order.trim()) : 0,
    };

    setSaving(true);
    try {
      if (editing) {
        await agencyApi.updateContact(editing.id, payload);
        toast.success('Contacto actualizado');
      } else {
        await agencyApi.createContact(payload);
        toast.success('Contacto creado');
      }
      setFormOpen(false);
      await load();
    } catch (error) {
      toast.error(apiMessage(error, 'No se pudo guardar el contacto'));
    } finally {
      setSaving(false);
    }
  };

  const runRowAction = async (
    contact: AgencyContact,
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    if (rowActionId) return;
    setRowActionId(contact.id);
    try {
      await action();
      toast.success(successMessage);
      await load();
    } catch (error) {
      toast.error(apiMessage(error, 'No se pudo actualizar el contacto'));
    } finally {
      setRowActionId(null);
    }
  };

  const handleToggleActive = (contact: AgencyContact) =>
    runRowAction(
      contact,
      () => agencyApi.updateContact(contact.id, { is_active: !contact.is_active }),
      contact.is_active ? 'Contacto desactivado' : 'Contacto activado',
    );

  const handleConfirmDelete = async () => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    try {
      await agencyApi.deleteContact(confirmDelete.id);
      toast.success('Contacto eliminado');
      setConfirmDelete(null);
      await load();
    } catch (error) {
      toast.error(apiMessage(error, 'No se pudo eliminar el contacto'));
    } finally {
      setDeleting(false);
    }
  };

  const publicCount = (contacts ?? []).filter(
    (c) => c.is_active && c.is_public,
  ).length;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader title="Contactos" />

      <div className="mb-6">
        <SectionTitle>Cómo te contactan tus clientes</SectionTitle>
        <p className="mt-3 max-w-3xl font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
          Estos números se muestran a los clientes del marketplace cuando
          necesiten comunicarse con tu agencia, por ejemplo si tu compra está
          en revisión o si aún no tienes un método de pago configurado.
          Contactar a la agencia no confirma reservas ni acepta comprobantes.
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
              {publicCount === 0
                ? 'Ningún contacto publicado todavía'
                : `${publicCount} contacto${publicCount === 1 ? '' : 's'} visible${publicCount === 1 ? '' : 's'} para tus clientes`}
            </p>
            <p className="mt-1 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
              {publicCount === 0
                ? 'Los contactos privados no se muestran a nadie fuera de tu agencia. Marca un contacto como público para que tus clientes del marketplace puedan verlo.'
                : 'Los contactos públicos y activos son los únicos que se muestran a los clientes. Puedes desactivar o volver privado un contacto en cualquier momento.'}
            </p>
          </div>
        </div>
      </Card>

      <div className="flex justify-end mb-4">
        <Button onClick={openCreate} disabled={loading || !!loadError}>
          <Plus className="w-4 h-4" strokeWidth={1.75} />
          Agregar contacto
        </Button>
      </div>

      {loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      )}

      {!loading && loadError && (
        <Card className="flex flex-col items-start gap-4">
          <div className="flex items-center gap-3 text-[#ef4444]">
            <Phone className="w-5 h-5" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm">
              No se pudieron cargar los contactos. Intenta de nuevo.
            </p>
          </div>
          <Button variant="secondary" onClick={load}>
            Reintentar
          </Button>
        </Card>
      )}

      {!loading && !loadError && contacts && contacts.length === 0 && (
        <EmptyState
          icon={<Phone className="w-8 h-8" strokeWidth={1.75} />}
          message="Todavía no tienes contactos. Agrega un número de contacto para que tus clientes del marketplace sepan cómo comunicarse contigo."
          action={{ label: 'Agregar contacto', onClick: openCreate }}
        />
      )}

      {!loading && !loadError && contacts && contacts.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {contacts.map((contact) => {
            const busy = rowActionId === contact.id;
            const ChannelIcon =
              contact.channel === 'whatsapp' ? MessageCircle : PhoneCall;
            return (
              <Card key={contact.id}>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)] truncate">
                        {contact.label}
                      </h2>
                      <Badge variant={contact.is_public ? 'info' : 'inactive'}>
                        {contact.is_public ? 'Público' : 'Privado'}
                      </Badge>
                      {!contact.is_active && (
                        <Badge variant="inactive">Inactivo</Badge>
                      )}
                    </div>
                    <p className="mt-1 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                      {CONTACT_CHANNEL_LABELS[contact.channel] ?? contact.channel}
                    </p>
                  </div>
                  <ChannelIcon
                    className="w-5 h-5 text-[var(--color-brand-muted)] shrink-0"
                    strokeWidth={1.75}
                  />
                </div>

                <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] mb-6">
                  {contact.phone}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEdit(contact)}
                    disabled={busy}
                  >
                    <Pencil className="w-4 h-4" strokeWidth={1.75} />
                    Editar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleToggleActive(contact)}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Power className="w-4 h-4" strokeWidth={1.75} />
                    )}
                    {contact.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmDelete(contact)}
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
        titleId="contact-form-title"
      >
        <form onSubmit={handleSave} className="p-6">
          <p
            id="contact-form-title"
            className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)] mb-1"
          >
            {editing ? 'Editar contacto' : 'Nuevo contacto'}
          </p>
          <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)] mb-6">
            Solo números: 11 dígitos (0424xxxxxxx) o + y 12 dígitos
            (+58424xxxxxxx). Los contactos privados no se muestran a los
            clientes del marketplace.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input
                label="Nombre del contacto"
                placeholder="Ej. Central WhatsApp"
                value={form.label}
                onChange={(e) =>
                  updateField('label', filterContactLabel(e.target.value))
                }
                error={formErrors.label}
                disabled={saving}
                maxLength={60}
              />
            </div>
            <Input
              label="Teléfono"
              placeholder="04121234567 o +584121234567"
              inputMode="tel"
              value={form.phone}
              onChange={(e) =>
                updateField('phone', filterPhoneInput(e.target.value))
              }
              error={formErrors.phone}
              disabled={saving}
              maxLength={PHONE_MAX_LENGTH}
              helperText={PHONE_FORMAT_MESSAGE}
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="contact-channel"
                className="font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider"
              >
                Canal
              </label>
              <select
                id="contact-channel"
                value={form.channel}
                onChange={(e) =>
                  updateField(
                    'channel',
                    e.target.value as ContactFormState['channel'],
                  )
                }
                disabled={saving}
                className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-4 py-3 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] disabled:opacity-40"
              >
                <option value="">Selecciona</option>
                <option value="call">Llamada</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
              {formErrors.channel && (
                <p className="font-[family-name:var(--font-body)] text-[12px] text-[#ef4444]">
                  {formErrors.channel}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="contact-visibility"
                className="font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider"
              >
                Visibilidad
              </label>
              <select
                id="contact-visibility"
                value={form.visibility}
                onChange={(e) =>
                  updateField(
                    'visibility',
                    e.target.value as ContactFormState['visibility'],
                  )
                }
                disabled={saving}
                className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-4 py-3 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] disabled:opacity-40"
              >
                <option value="private">Privado (solo tu agencia)</option>
                <option value="public">Público (visible en el marketplace)</option>
              </select>
            </div>
            <Input
              label="Orden (opcional)"
              placeholder="0"
              inputMode="numeric"
              value={form.sort_order}
              onChange={(e) =>
                updateField('sort_order', filterSortOrderInput(e.target.value))
              }
              error={formErrors.sort_order}
              disabled={saving}
              maxLength={4}
              helperText="Menor número aparece primero en la lista."
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
              {editing ? 'Guardar cambios' : 'Crear contacto'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!confirmDelete}
        title="¿Eliminar este contacto?"
        message={
          confirmDelete
            ? `El contacto "${confirmDelete.label}" dejará de estar disponible. Los clientes del marketplace no podrán verlo ni usarlo.`
            : ''
        }
        confirmLabel="Eliminar contacto"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}
