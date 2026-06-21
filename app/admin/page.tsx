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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb + Title */}
        <div className="mb-6 sm:mb-8">
          <p className="font-['Poppins',sans-serif] font-normal text-xs text-brand-muted">
            <Link href="/admin" className="text-brand-cyan no-underline hover:underline">Admin</Link>
            {' / Panel'}
          </p>
          <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[22px] sm:text-2xl text-brand-navy">
            Panel de Administración
          </h1>
        </div>

        {/* Metrics cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[rgba(0,212,255,0.1)]">
                <svg className="w-5 h-5 text-brand-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">
                Viajes activos
              </p>
            </div>
            <p className="font-['Montserrat',sans-serif] font-extrabold text-4xl text-brand-navy leading-none">
              {tripsCount ?? 0}
            </p>
          </div>

          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[rgba(0,212,255,0.1)]">
                <svg className="w-5 h-5 text-brand-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">
                Reservas confirmadas
              </p>
            </div>
            <p className="font-['Montserrat',sans-serif] font-extrabold text-4xl text-brand-navy leading-none">
              {bookingsCount ?? 0}
            </p>
          </div>

          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[rgba(0,212,255,0.1)]">
                <svg className="w-5 h-5 text-brand-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <p className="font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">
                Rutas
              </p>
            </div>
            <p className="font-['Montserrat',sans-serif] font-extrabold text-4xl text-brand-navy leading-none">
              {routesCount ?? 0}
            </p>
          </div>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <Link
            href="/admin/trips"
            className="block bg-white rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5 shadow-[0_2px_8px_rgba(0,0,0,0.07)] border-l-4 border-l-brand-cyan no-underline"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-brand-navy">
                <svg className="w-6 h-6 text-brand-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="font-['Poppins',sans-serif] font-semibold text-[17px] text-brand-navy">
                  Gestión de viajes
                </h2>
                <p className="font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted">
                  Crear, editar y eliminar viajes
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/routes"
            className="block bg-white rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5 shadow-[0_2px_8px_rgba(0,0,0,0.07)] border-l-4 border-l-brand-cyan no-underline"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-brand-navy">
                <svg className="w-6 h-6 text-brand-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <div>
                <h2 className="font-['Poppins',sans-serif] font-semibold text-[17px] text-brand-navy">
                  Gestión de rutas
                </h2>
                <p className="font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted">
                  Administrar rutas disponibles
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>
  );
}
