import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function AdminDashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect('/login');
  }

  const role = userData.user?.user_metadata?.role ?? 'user';
  if (role !== 'admin') {
    redirect('/dashboard');
  }

  const { count: tripsCount } = await supabase
    .from('trips')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  const { count: bookingsCount } = await supabase
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'confirmed');

  const { count: routesCount } = await supabase
    .from('routes')
    .select('*', { count: 'exact', head: true });

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100vh' }}>
      <div className="max-w-7xl mx-auto" style={{ padding: '32px 24px' }}>
        {/* Breadcrumb + Title */}
        <div className="mb-8">
          <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 12, color: 'var(--color-brand-muted)' }}>
            Admin / Panel
          </p>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26, color: 'var(--color-brand-navy)' }}>
            Panel de Administración
          </h1>
        </div>

        {/* Metrics cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(8,142,184,0.1)' }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="var(--color-brand-cyan)" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Viajes activos
              </p>
            </div>
            <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 36, color: 'var(--color-brand-navy)', lineHeight: 1 }}>
              {tripsCount ?? 0}
            </p>
          </div>

          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(8,142,184,0.1)' }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="var(--color-brand-cyan)" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Reservas confirmadas
              </p>
            </div>
            <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 36, color: 'var(--color-brand-navy)', lineHeight: 1 }}>
              {bookingsCount ?? 0}
            </p>
          </div>

          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(8,142,184,0.1)' }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="var(--color-brand-cyan)" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Rutas
              </p>
            </div>
            <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 36, color: 'var(--color-brand-navy)', lineHeight: 1 }}>
              {routesCount ?? 0}
            </p>
          </div>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <Link
            href="/admin/trips"
            className="block bg-white rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5"
            style={{
              boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
              borderLeft: '4px solid var(--color-brand-cyan)',
              textDecoration: 'none',
            }}
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'var(--color-brand-navy)' }}
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="var(--color-brand-cyan)" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 17, color: 'var(--color-brand-navy)' }}>
                  Gestión de viajes
                </h2>
                <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: 'var(--color-brand-muted)' }}>
                  Crear, editar y eliminar viajes
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/routes"
            className="block bg-white rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5"
            style={{
              boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
              borderLeft: '4px solid var(--color-brand-cyan)',
              textDecoration: 'none',
            }}
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'var(--color-brand-navy)' }}
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="var(--color-brand-cyan)" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 17, color: 'var(--color-brand-navy)' }}>
                  Gestión de rutas
                </h2>
                <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: 'var(--color-brand-muted)' }}>
                  Administrar rutas disponibles
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
