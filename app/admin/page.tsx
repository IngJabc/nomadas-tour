import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function AdminDashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: user } = await supabase.auth.getUser();

  if (!user.user) {
    redirect('/login');
  }

  const role = user.user?.user_metadata?.role ?? 'user';
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">Panel Admin</h1>
          <div className="flex gap-3">
            <Link
              href="/"
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300"
            >
              Sitio web
            </Link>
            <form action="/auth/signout" method="post">
              <button className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600">
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl p-6 shadow-md">
            <p className="text-sm text-gray-500">Viajes activos</p>
            <p className="text-3xl font-bold text-gray-800">{tripsCount ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-md">
            <p className="text-sm text-gray-500">Reservas confirmadas</p>
            <p className="text-3xl font-bold text-gray-800">{bookingsCount ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-md">
            <p className="text-sm text-gray-500">Rutas</p>
            <p className="text-3xl font-bold text-gray-800">{routesCount ?? 0}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/admin/trips"
            className="bg-white rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow"
          >
            <h2 className="text-lg font-semibold text-gray-800">Gestión de viajes</h2>
            <p className="text-sm text-gray-500 mt-1">Crear, editar y eliminar viajes</p>
          </Link>
          <Link
            href="/admin/routes"
            className="bg-white rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow"
          >
            <h2 className="text-lg font-semibold text-gray-800">Gestión de rutas</h2>
            <p className="text-sm text-gray-500 mt-1">Administrar rutas disponibles</p>
          </Link>
        </div>
      </main>
    </div>
  );
}
