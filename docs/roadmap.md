# Roadmap

---

# Fase 1 — Alineación Backend con nuevo modelo

Objetivo:
Actualizar backend para trabajar con el nuevo schema de Supabase.

Cambios:

- Actualizar types/interfaces.
- Actualizar roles:
  - superadmin
  - agency

Eliminar:

- customer
- user customer
- allocated seats
- trip_agency_allocations

Mantener:

- Supabase Auth
- agencyId como contexto multi-tenant

Actualizar:

- middleware auth
- middleware authorization
- tenant context

---

# Fase 2 — Superadmin Domain

Objetivo:
Adaptar administración global al nuevo modelo.

Implementar:

- Crear agencias.
- Crear rutas.
- Crear viajes.
- Asignar agencias autorizadas a viajes.

Eliminar:

- distribución de cupos
- reserved_seats
- allocated_seats

Nuevo modelo:

Trip

↓

Trip Agencies

---

# Fase 3 — Sistema de reservas por agencia

Objetivo:
Permitir que las agencias creen reservas.

Implementar:

POST /api/agency/reservations

Flujo:

Agencia selecciona:

- viaje
- plazas

Ingresa:

Responsable de reserva:

- nombre
- documento
- teléfono

Ingresa pasajeros:

Cada pasajero:

- nombre
- documento
- teléfono
- seat_id

Crear:

- reservations
- reservation_passengers

Generar:

QR único por reserva

---

# Fase 4 — Abordaje QR por plazas

Objetivo:
Controlar abordaje parcial.

Flujo:

Agencia escanea QR.

Mostrar:

- información del viaje
- nombre de quien reservó
- cantidad total pasajeros
- plazas disponibles

NO mostrar:

- nombres de pasajeros

La agencia selecciona mediante switches:

A1
A2
A3

Registrar:

- passenger boarded
- boarded_at
- boarded_by

Crear:

boarding_logs

---

# Fase 5 — Dashboard Agencia

Implementar:

Mis viajes:

- viajes autorizados

Mis reservas:

- reservas propias

Pasajeros:

Mostrar:

- nombre
- documento
- teléfono
- responsable de reserva

Abordaje:

Mostrar progreso:

8/8 pasajeros abordados

---

# Fase 6 — Eliminar legacy customer

Eliminar:

- customer routes
- customer dashboard
- optionalAuth donde no aplique
- lógica antigua de reservas públicas

Limpiar:

- componentes
- tipos
- servicios obsoletos

---

# Fase 7 — Auditoría y mejoras

Implementar:

Correcciones de abordaje:

- correction logs

Historial:

- quién marcó pasajeros
- cuándo
- qué plazas

Optimización:

- lookup QR directo

Tests:

- creación de reservas
- abordaje parcial
- aislamiento multi-tenant

Documentación técnica final.
