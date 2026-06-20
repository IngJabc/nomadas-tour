import { z } from 'zod';

export const bookingSchema = z.object({
  trip_id: z.string().uuid(),
  seat_id: z.string().uuid(),
  passenger_name: z
    .string()
    .min(2, 'Nombre debe tener al menos 2 caracteres')
    .regex(/^[A-Za-zÁÉÍÓÚÑáéíóúñüÜ\s]+$/, 'Nombre solo puede contener letras y espacios'),
  passenger_cedula: z
    .string()
    .min(4, 'Cédula debe tener al menos 4 dígitos')
    .max(8, 'Cédula debe tener máximo 8 dígitos')
    .regex(/^\d+$/, 'Cédula solo puede contener números'),
  qr_code: z.string().optional(),
});

export type BookingFormData = z.infer<typeof bookingSchema>;

export const tripSchema = z.object({
  route_id: z.string().uuid('Seleccione una ruta'),
  departure_at: z.string().min(1, 'Seleccione fecha y hora'),
  price: z.number().positive('El precio debe ser positivo'),
  total_seats: z.number().int().min(4, 'Mínimo 4 asientos').max(100, 'Máximo 100 asientos'),
  decks: z.number().int().min(1).max(2),
});

export type TripFormData = z.infer<typeof tripSchema>;

export const routeSchema = z.object({
  origin: z.string().min(2, 'Origen requerido'),
  destination: z.string().min(2, 'Destino requerido'),
  duration_minutes: z.number().positive('Duración debe ser positiva'),
});

export type RouteFormData = z.infer<typeof routeSchema>;
