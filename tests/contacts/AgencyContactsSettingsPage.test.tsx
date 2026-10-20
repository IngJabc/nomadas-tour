import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  mockListContacts,
  mockCreateContact,
  mockUpdateContact,
  mockDeleteContact,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockListContacts: vi.fn(),
  mockCreateContact: vi.fn(),
  mockUpdateContact: vi.fn(),
  mockDeleteContact: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    listContacts: () => mockListContacts(),
    createContact: (data: unknown) => mockCreateContact(data),
    updateContact: (id: string, patch: unknown) => mockUpdateContact(id, patch),
    deleteContact: (id: string) => mockDeleteContact(id),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import AgencyContactsSettingsPage from '@/app/agency/settings/contacts/page';
import { ApiError } from '@/lib/errors/api-error';

const CONTACT_ID = '99999999-9999-4999-8999-999999999999';

function contactFixture(partial: Record<string, unknown> = {}) {
  return {
    id: CONTACT_ID,
    agency_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    label: 'Central WhatsApp',
    phone: '+584121234567',
    channel: 'whatsapp',
    is_active: true,
    is_public: true,
    sort_order: 0,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    deleted_at: null,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListContacts.mockResolvedValue({ contacts: [contactFixture()] });
});

describe('AgencyContactsSettingsPage (MKT-008)', () => {
  it('lista los contactos existentes con detalle y etiquetas de estado', async () => {
    render(<AgencyContactsSettingsPage />);

    expect(await screen.findByText('Central WhatsApp')).toBeTruthy();
    expect(screen.getByText('+584121234567')).toBeTruthy();
    expect(screen.getByText('WhatsApp')).toBeTruthy();
    expect(screen.getByText('Público')).toBeTruthy();
    expect(mockListContacts).toHaveBeenCalledTimes(1);
  });

  it('muestra la etiqueta Privado para un contacto no público', async () => {
    mockListContacts.mockResolvedValue({
      contacts: [contactFixture({ is_public: false })],
    });

    render(<AgencyContactsSettingsPage />);

    expect(await screen.findByText('Central WhatsApp')).toBeTruthy();
    expect(screen.getByText('Privado')).toBeTruthy();
  });

  it('muestra la etiqueta Inactivo para un contacto desactivado', async () => {
    mockListContacts.mockResolvedValue({
      contacts: [contactFixture({ is_active: false })],
    });

    render(<AgencyContactsSettingsPage />);

    expect(await screen.findByText('Central WhatsApp')).toBeTruthy();
    expect(screen.getByText('Inactivo')).toBeTruthy();
  });

  it('muestra empty state con CTA cuando no hay contactos', async () => {
    mockListContacts.mockResolvedValue({ contacts: [] });

    render(<AgencyContactsSettingsPage />);

    expect(await screen.findByText(/Todavía no tienes contactos/)).toBeTruthy();
    const ctas = screen.getAllByRole('button', { name: /Agregar contacto/ });
    expect(ctas.length).toBeGreaterThan(0);
  });

  it('muestra error de carga con botón de reintentar', async () => {
    mockListContacts.mockRejectedValue(new Error('boom'));

    render(<AgencyContactsSettingsPage />);

    expect(
      await screen.findByText(
        'No se pudieron cargar los contactos. Intenta de nuevo.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('el borrado siempre pasa por el modal de confirmación', async () => {
    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getByRole('button', { name: /Eliminar/ }));

    // Sin confirmar todavía: la API no se toca.
    expect(mockDeleteContact).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    mockDeleteContact.mockResolvedValue({
      contact: contactFixture({ deleted_at: '2026-10-02T00:00:00.000Z' }),
      already_deleted: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar contacto' }));

    await waitFor(() => {
      expect(mockDeleteContact).toHaveBeenCalledWith(CONTACT_ID);
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Contacto eliminado');
  });

  it('crear valida el teléfono antes de llamar a la API', async () => {
    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getAllByRole('button', { name: /Agregar contacto/ })[0]);

    fireEvent.change(screen.getByLabelText(/Nombre del contacto/), {
      target: { value: 'Oficina' },
    });
    // Teléfono incompleto (6 dígitos): fuera del contrato 11 / +12.
    fireEvent.change(screen.getByLabelText(/Teléfono/), {
      target: { value: '041212' },
    });
    fireEvent.change(screen.getByLabelText('Canal'), {
      target: { value: 'call' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }));

    expect(mockCreateContact).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      'Revisa los datos del contacto',
    );
    // El texto del formato tambien vive en el helper del campo; alcanza con
    // que aparezca al menos una vez (el error del campo).
    expect(
      screen.getAllByText(/Formato: 0424xxxxxxx o \+58424xxxxxxx/).length,
    ).toBeGreaterThan(0);
  });

  it('rechaza sort_order fuera del contrato del backend (1001) antes de enviar', async () => {
    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getAllByRole('button', { name: /Agregar contacto/ })[0]);
    fireEvent.change(screen.getByLabelText(/Nombre del contacto/), {
      target: { value: 'Oficina' },
    });
    fireEvent.change(screen.getByLabelText(/Teléfono/), {
      target: { value: '+584121234567' },
    });
    fireEvent.change(screen.getByLabelText('Canal'), {
      target: { value: 'call' },
    });
    fireEvent.change(screen.getByLabelText(/Orden/), {
      target: { value: '1001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }));

    expect(mockCreateContact).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('Revisa los datos del contacto');
    expect(
      screen.getByText('El orden debe ser un número entero entre 0 y 1000.'),
    ).toBeTruthy();
  });

  it('acepta sort_order en los límites del contrato (0 y 1000)', async () => {
    mockCreateContact.mockResolvedValue({ contact: contactFixture() });

    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getAllByRole('button', { name: /Agregar contacto/ })[0]);
    fireEvent.change(screen.getByLabelText(/Nombre del contacto/), {
      target: { value: 'Oficina' },
    });
    fireEvent.change(screen.getByLabelText(/Teléfono/), {
      target: { value: '+584121234567' },
    });
    fireEvent.change(screen.getByLabelText('Canal'), {
      target: { value: 'call' },
    });
    fireEvent.change(screen.getByLabelText(/Orden/), {
      target: { value: '1000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }));

    await waitFor(() => {
      expect(mockCreateContact).toHaveBeenCalledWith({
        label: 'Oficina',
        phone: '+584121234567',
        channel: 'call',
        is_public: false,
        sort_order: 1000,
      });
    });
    // El caso 0 ya lo cubre el test de creación válida (sort_order por defecto 0).
  });

  it('crea un contacto válido con el formato del sistema y recarga la lista', async () => {
    mockCreateContact.mockResolvedValue({ contact: contactFixture() });

    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getAllByRole('button', { name: /Agregar contacto/ })[0]);

    fireEvent.change(screen.getByLabelText(/Nombre del contacto/), {
      target: { value: 'Oficina' },
    });
    // Nacional con separadores: el input deja solo dígitos (11 en total).
    fireEvent.change(screen.getByLabelText(/Teléfono/), {
      target: { value: '0412 123 4567' },
    });
    fireEvent.change(screen.getByLabelText('Canal'), {
      target: { value: 'call' },
    });
    fireEvent.change(screen.getByLabelText('Visibilidad'), {
      target: { value: 'public' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }));

    await waitFor(() => {
      expect(mockCreateContact).toHaveBeenCalledWith({
        label: 'Oficina',
        phone: '04121234567',
        channel: 'call',
        is_public: true,
        sort_order: 0,
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Contacto creado');
  });

  it('activa y desactiva un contacto desde la tarjeta', async () => {
    mockUpdateContact.mockResolvedValue({ contact: contactFixture() });

    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getByRole('button', { name: /Desactivar/ }));

    await waitFor(() => {
      expect(mockUpdateContact).toHaveBeenCalledWith(CONTACT_ID, {
        is_active: false,
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Contacto desactivado');
  });

  it('muestra el mensaje del API cuando la creación falla', async () => {
    mockCreateContact.mockRejectedValue(
      new ApiError('Ya existe un contacto con este número', 'ERR', 400),
    );

    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getAllByRole('button', { name: /Agregar contacto/ })[0]);
    fireEvent.change(screen.getByLabelText(/Nombre del contacto/), {
      target: { value: 'Oficina' },
    });
    fireEvent.change(screen.getByLabelText(/Teléfono/), {
      target: { value: '+584129998877' },
    });
    fireEvent.change(screen.getByLabelText('Canal'), {
      target: { value: 'whatsapp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Ya existe un contacto con este número',
      );
    });
  });

  it('el campo Orden solo admite dígitos mientras se escribe', async () => {
    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getAllByRole('button', { name: /Agregar contacto/ })[0]);

    const orden = screen.getByLabelText(/Orden/) as HTMLInputElement;
    fireEvent.change(orden, { target: { value: 'abc10x' } });
    expect(orden.value).toBe('10');
  });

  it('el campo de nombre quita caracteres de control y recorta a 60', async () => {
    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getAllByRole('button', { name: /Agregar contacto/ })[0]);

    const nombre = screen.getByLabelText(
      /Nombre del contacto/,
    ) as HTMLInputElement;
    fireEvent.change(nombre, { target: { value: 'Oficina\u0000' } });
    expect(nombre.value).toBe('Oficina');
    fireEvent.change(nombre, { target: { value: 'x'.repeat(70) } });
    expect(nombre.value).toHaveLength(60);
  });

  it('revalida el campo en vivo tras un intento fallido y permite enviar', async () => {
    mockCreateContact.mockResolvedValue({ contact: contactFixture() });

    render(<AgencyContactsSettingsPage />);
    await screen.findByText('Central WhatsApp');

    fireEvent.click(screen.getAllByRole('button', { name: /Agregar contacto/ })[0]);
    fireEvent.change(screen.getByLabelText(/Nombre del contacto/), {
      target: { value: 'Oficina' },
    });
    fireEvent.change(screen.getByLabelText(/Teléfono/), {
      target: { value: '041212' },
    });
    fireEvent.change(screen.getByLabelText('Canal'), {
      target: { value: 'call' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }));

    expect(mockCreateContact).not.toHaveBeenCalled();
    expect(
      screen.getByText('Formato: 0424xxxxxxx o +58424xxxxxxx.'),
    ).toBeTruthy();

    // Corregir el teléfono en vivo: el error se va sin reenviar y vuelve
    // el helper del campo (solo se muestra cuando no hay error).
    fireEvent.change(screen.getByLabelText(/Teléfono/), {
      target: { value: '04121234567' },
    });
    await waitFor(() => {
      expect(
        screen.getByText('Formato: 0424xxxxxxx o +58424xxxxxxx'),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }));
    await waitFor(() => {
      expect(mockCreateContact).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '04121234567' }),
      );
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Contacto creado');
  });
});
