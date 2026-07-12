import { TripsListClient } from '@/components/trips/TripsListClient';
import { customerApi } from '@/lib/api';

export default async function HomePage() {
  let tripsWithAvailability: any[] = [];

  try {
    const data = await customerApi.listTrips();
    tripsWithAvailability = Array.isArray(data) ? data : [];
  } catch {
    tripsWithAvailability = [];
  }

  return (
    <div className="min-h-screen bg-slate-100 pt-16">
      <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex items-start gap-3 mb-5 sm:mb-6">
          <div className="w-1 h-6 sm:h-7 bg-brand-cyan shrink-0" />
          <h2 className="font-['Montserrat',sans-serif] font-extrabold text-[22px] sm:text-[28px] text-brand-navy">Viajes disponibles</h2>
        </div>

        {!tripsWithAvailability || tripsWithAvailability.length === 0 ? (
          <div className="text-center mt-20">
            <svg className="mx-auto mb-6" width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="10" y="30" width="80" height="30" rx="6" fill="#e6eef6" />
              <circle cx="30" cy="65" r="6" fill="#cbdffd" />
              <circle cx="70" cy="65" r="6" fill="#cbdffd" />
            </svg>
            <div className="font-['Poppins',sans-serif] font-semibold text-lg text-brand-navy">No hay viajes disponibles por ahora</div>
            <div className="font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">Vuelve pronto, estamos preparando nuevas rutas</div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <TripsListClient trips={tripsWithAvailability} />
          </div>
        )}
      </main>
    </div>
  );
}
