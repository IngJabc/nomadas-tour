import { z } from 'zod';

export const bookingSchema = z.object({
  trip_id: z.string().uuid(),
  seat_id: z.string().uuid(),
  passenger_name: z.string().min(2, 'Nombre debe tener al menos 2 caracteres'),
  passenger_email: z.string().email('Email inválido'),
});

export type BookingFormData = z.infer<typeof bookingSchema>;

export const tripSchema = z.object({
  route_id: z.string().uuid('Seleccione una ruta'),
  departure_at: z.string().min(1, 'Seleccione fecha y hora'),
  price: z.number().positive('El precio debe ser positivo'),
});

export type TripFormData = z.infer<typeof tripSchema>;

export const routeSchema = z.object({
  origin: z.string().min(2, 'Origen requerido'),
  destination: z.string().min(2, 'Destino requerido'),
  duration_minutes: z.number().positive('Duración debe ser positiva'),
});

export type RouteFormData = z.infer<typeof routeSchema>;
