import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { MarketplaceAgencyShowcase } from '@/lib/api';

const {
  mockListShowcaseAgencies,
  mockUpdateShowcase,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockListShowcaseAgencies: vi.fn(),
  mockUpdateShowcase: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  marketplaceAdminApi: {
    listShowcaseAgencies: () => mockListShowcaseAgencies(),
    updateShowcase: (agencyId: string, data: unknown) =>
      mockUpdateShowcase(agencyId, data),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (message: string) => mockToastSuccess(message),
    error: (message: string) => mockToastError(message),
  },
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import FeaturedAgenciesPage from '@/app/admin/featured-agencies/page';

// ── REP-001 · Panel superadmin de agencias destacadas ───────────────────────
// Cubre: listado (logo, estado, orden), destacar/quitar (con confirmación),
// reordenar + guardar (posiciones contiguas 1..N, SOLO destacadas),
// validación de movimientos y manejo de errores del listado y del guardado.

const makeAgency = (
  id: string,
  name: string,
  is_featured: boolean,
  featured_order: number,
  logo_url: string | null = null
): MarketplaceAgencyShowcase => ({
  id,
  name,
  subdomain: id,
  logo_url,
  is_featured,
  featured_order,
});

const baseAgencies = [
  makeAgency('a1', 'Agencia Uno', true, 1, 'https://cdn.example/uno.png'),
  makeAgency('a2', 'Agencia Dos', true, 2),
  makeAgency('a3', 'Agencia Tres', false, 0),
];

const ORDERING_HEADING = 'Orden en el directorio';
const ALL_HEADING = 'Agencias activas';

const getOrderingSection = () =>
  screen
    .getByRole('heading', { name: ORDERING_HEADING })
    .closest('section') as HTMLElement;

const getAllSection = () =>
  screen
    .getByRole('heading', { name: ALL_HEADING })
    .closest('section') as HTMLElement;

const getButton = (name: string) =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

const isDisabled = (name: string) => getButton(name).disabled;

async function renderPage() {
  render(<FeaturedAgenciesPage />);
  await screen.findByRole('heading', { level: 1, name: 'Agencias destacadas' });
}

beforeEach(() => {
  mockListShowcaseAgencies.mockReset();
  mockUpdateShowcase.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockListShowcaseAgencies.mockResolvedValue({
    agencies: baseAgencies,
    total: baseAgencies.length,
  });
  mockUpdateShowcase.mockResolvedValue({ agency: baseAgencies[0] });
});

describe('listado de agencias activas', () => {
  it('muestra nombre, logo, estado destacado y orden de cada agencia', async () => {
    await renderPage();

    // Orden manual arriba: solo destacadas, en el orden del servidor.
    const rows = within(getOrderingSection()).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Agencia Uno');
    expect(rows[1].textContent).toContain('Agencia Dos');
    expect(within(getOrderingSection()).getByText('1')).not.toBeNull();
    expect(within(getOrderingSection()).getByText('2')).not.toBeNull();

    // Listado completo: estado y orden actual de TODAS las activas.
    const all = getAllSection();
    expect(within(all).getByText('Agencia Tres')).not.toBeNull();
    expect(within(all).getByText('Orden 1')).not.toBeNull();
    expect(within(all).getByText('Orden 2')).not.toBeNull();
    expect(within(all).getByText('No destacada')).not.toBeNull();
    expect(within(all).getByText('Sin orden')).not.toBeNull();

    // Logo (con respaldo por alt) y badges de destacada (orden + listado).
    expect(screen.getAllByAltText('Logo de Agencia Uno')).toHaveLength(2);
    expect(screen.getAllByText('Destacada')).toHaveLength(4);

    // Sin cambios locales: guardar está deshabilitado.
    expect(isDisabled('Guardar orden')).toBe(true);
  });

  it('mantiene el esqueleto de carga hasta que responde el listado', async () => {
    render(<FeaturedAgenciesPage />);

    expect(document.querySelector('.animate-pulse')).not.toBeNull();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Agencias destacadas' })
    ).toBeNull();

    await screen.findByRole('heading', { level: 1, name: 'Agencias destacadas' });
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });

  it('muestra error y permite reintentar si el listado falla', async () => {
    mockListShowcaseAgencies.mockRejectedValueOnce(new Error('network down'));

    render(<FeaturedAgenciesPage />);

    const banner = await screen.findByText(
      'No se pudieron cargar las agencias del marketplace. Intenta de nuevo.'
    );
    expect(banner).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() =>
      expect(mockListShowcaseAgencies).toHaveBeenCalledTimes(2)
    );
    expect(await screen.findAllByAltText('Logo de Agencia Uno')).toHaveLength(2);
    expect(
      screen.queryByText(
        'No se pudieron cargar las agencias del marketplace. Intenta de nuevo.'
      )
    ).toBeNull();
  });
});

describe('destacar / quitar agencias', () => {
  it('destaca una agencia al final del grupo con loading, éxito y recarga', async () => {
    let resolveUpdate!: (value: unknown) => void;
    mockUpdateShowcase.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        })
    );

    await renderPage();

    const button = getButton('Destacar Agencia Tres');
    fireEvent.click(button);

    // Siguiente posición vigente (1,2 → 3) y estado de loading visible.
    expect(mockUpdateShowcase).toHaveBeenCalledWith('a3', {
      is_featured: true,
      featured_order: 3,
    });
    expect(button.disabled).toBe(true);

    resolveUpdate({ agency: {} });

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Agencia Tres ahora es destacada'
      )
    );
    await waitFor(() =>
      expect(mockListShowcaseAgencies).toHaveBeenCalledTimes(2)
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('al quitar pide confirmación y cancelar no toca el backend', async () => {
    await renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar Agencia Uno de destacadas' })
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Quitar de destacadas')).not.toBeNull();
    expect(
      within(dialog).getByText(/Agencia Uno dejará de aparecer primero/)
    ).not.toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockUpdateShowcase).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('confirmar quitar envía SOLO is_featured:false (sin orden) y recarga', async () => {
    await renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar Agencia Uno de destacadas' })
    );

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quitar' }));

    await waitFor(() =>
      expect(mockUpdateShowcase).toHaveBeenCalledWith('a1', {
        is_featured: false,
      })
    );
    // El backend resetea el orden: jamás se envía featured_order al quitar.
    expect(mockUpdateShowcase).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Agencia Uno salió de destacadas'
    );
    await waitFor(() =>
      expect(mockListShowcaseAgencies).toHaveBeenCalledTimes(2)
    );
  });

  it('un fallo al destacar muestra error y NO recarga la lista', async () => {
    mockUpdateShowcase.mockRejectedValueOnce(new Error('SERVER_DOWN'));

    await renderPage();

    fireEvent.click(getButton('Destacar Agencia Tres'));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('SERVER_DOWN')
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockListShowcaseAgencies).toHaveBeenCalledTimes(1);
  });
});

describe('orden manual de destacadas', () => {
  it('permite reordenar localmente y habilita guardar con cambios', async () => {
    await renderPage();

    let rows = within(getOrderingSection()).getAllByRole('listitem');
    expect(rows[0].textContent).toContain('Agencia Uno');
    expect(rows[1].textContent).toContain('Agencia Dos');
    expect(screen.queryByText('Cambios sin guardar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bajar Agencia Uno' }));

    rows = within(getOrderingSection()).getAllByRole('listitem');
    expect(rows[0].textContent).toContain('Agencia Dos');
    expect(rows[1].textContent).toContain('Agencia Uno');
    expect(screen.queryByText('Cambios sin guardar')).not.toBeNull();
    expect(isDisabled('Guardar orden')).toBe(false);
  });

  it('bloquea movimientos fuera de rango (posiciones inválidas)', async () => {
    await renderPage();

    expect(isDisabled('Subir Agencia Uno')).toBe(true);
    expect(isDisabled('Bajar Agencia Dos')).toBe(true);
    expect(isDisabled('Bajar Agencia Uno')).toBe(false);
    expect(isDisabled('Subir Agencia Dos')).toBe(false);

    // El botón deshabilitado no produce cambios.
    fireEvent.click(screen.getByRole('button', { name: 'Subir Agencia Uno' }));
    expect(screen.queryByText('Cambios sin guardar')).toBeNull();
  });

  it('guarda posiciones contiguas 1..N SOLO en agencias destacadas', async () => {
    await renderPage();

    // El refetch posterior al guardado devuelve el nuevo orden del servidor.
    mockListShowcaseAgencies.mockResolvedValueOnce({
      agencies: [
        makeAgency('a2', 'Agencia Dos', true, 1),
        makeAgency('a1', 'Agencia Uno', true, 2, 'https://cdn.example/uno.png'),
        makeAgency('a3', 'Agencia Tres', false, 0),
      ],
      total: 3,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Bajar Agencia Uno' }));
    fireEvent.click(getButton('Guardar orden'));

    await waitFor(() =>
      expect(mockUpdateShowcase).toHaveBeenCalledTimes(2)
    );
    expect(mockUpdateShowcase).toHaveBeenCalledWith('a2', {
      featured_order: 1,
    });
    expect(mockUpdateShowcase).toHaveBeenCalledWith('a1', {
      featured_order: 2,
    });
    // Nunca se le envía orden a una agencia no destacada.
    expect(mockUpdateShowcase).not.toHaveBeenCalledWith(
      'a3',
      expect.anything()
    );

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('Orden guardado')
    );
    // Tras recargar: sin cambios pendientes y guardar deshabilitado.
    await waitFor(() => expect(isDisabled('Guardar orden')).toBe(true));
    expect(screen.queryByText('Cambios sin guardar')).toBeNull();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('un fallo al guardar conserva el orden local y muestra error', async () => {
    mockUpdateShowcase.mockRejectedValue(new Error('No se pudo guardar'));

    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Bajar Agencia Uno' }));
    fireEvent.click(getButton('Guardar orden'));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('No se pudo guardar')
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();

    // El orden elegido se conserva (sin revertir) para poder reintentar.
    const rows = within(getOrderingSection()).getAllByRole('listitem');
    expect(rows[0].textContent).toContain('Agencia Dos');
    expect(rows[1].textContent).toContain('Agencia Uno');
    expect(screen.queryByText('Cambios sin guardar')).not.toBeNull();
    expect(isDisabled('Guardar orden')).toBe(false);
    // Sin refetch en fallo: el listado no se recarga.
    expect(mockListShowcaseAgencies).toHaveBeenCalledTimes(1);
  });
});

describe('estados vacíos', () => {
  it('sin destacadas muestra un CTA que lleva al listado de agencias', async () => {
    mockListShowcaseAgencies.mockResolvedValue({
      agencies: [makeAgency('a3', 'Agencia Tres', false, 0)],
      total: 1,
    });

    const scrollSpy = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView =
      scrollSpy;

    await renderPage();

    expect(
      screen.getByText(
        'Aún no hay agencias destacadas. Destaca agencias para que aparezcan primero en el directorio.'
      )
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Destacar una agencia' }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it('sin agencias activas muestra empty state con CTA hacia Agencias', async () => {
    mockListShowcaseAgencies.mockResolvedValue({ agencies: [], total: 0 });

    await renderPage();

    expect(
      screen.getByText(
        'No hay agencias activas en el directorio del Marketplace'
      )
    ).not.toBeNull();

    const links = screen.getAllByRole('link', { name: 'Ir a Agencias' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toBe('/admin/agencies');
  });
});
