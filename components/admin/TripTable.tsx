'use client';

import { Trip } from '@/types';
import { formatDateTime, formatPrice } from '@/lib/utils';

interface TripTableProps {
  trips: Trip[];
  onEdit: (trip: Trip) => void;
  onDelete: (tripId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Activo',
  cancelled: 'Cancelado',
  completed: 'Completado',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green-600 bg-green-100',
  cancelled: 'text-red-600 bg-red-100',
  completed: 'text-gray-600 bg-gray-100',
};

export function TripTable({ trips, onEdit, onDelete }: TripTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-3 px-4 font-medium text-gray-600">Salida</th>
            <th className="text-left py-3 px-4 font-medium text-gray-600">Ruta</th>
            <th className="text-left py-3 px-4 font-medium text-gray-600">Precio</th>
            <th className="text-left py-3 px-4 font-medium text-gray-600">Estado</th>
            <th className="text-left py-3 px-4 font-medium text-gray-600">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => (
            <tr key={trip.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-3 px-4">{formatDateTime(trip.departure_at)}</td>
              <td className="py-3 px-4">
                {trip.route?.origin ?? '—'} → {trip.route?.destination ?? '—'}
              </td>
              <td className="py-3 px-4">{formatPrice(trip.price)}</td>
              <td className="py-3 px-4">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[trip.status]}`}>
                  {STATUS_LABELS[trip.status]}
                </span>
              </td>
              <td className="py-3 px-4">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(trip)}
                    className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-100 rounded-lg hover:bg-blue-200"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(trip.id)}
                    className="px-3 py-1 text-xs font-medium text-red-600 bg-red-100 rounded-lg hover:bg-red-200"
                  >
                    Eliminar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
