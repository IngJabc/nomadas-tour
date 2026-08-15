# SYSTEM SPEC — MULTI-TENANT TRAVEL PLATFORM

Este documento resume la arquitectura y las reglas vigentes del sistema. Las
decisiones ADR y las migraciones aplicadas prevalecen cuando exista una
diferencia con descripciones históricas.

---

# 1. VISIÓN GENERAL

Sistema SaaS multi-tenant B2B para gestión de viajes, reservas, pasajeros y abordaje.

NO maneja pagos ni ventas.

Roles del sistema: SUPERADMIN y AGENCY.
Los pasajeros NO tienen usuario ni acceso al sistema.

---

# 2. STACK

- Frontend: Next.js + TypeScript + TailwindCSS
- Backend: Node.js + Express (API separada)
- Database: Supabase (PostgreSQL)
- Auth: Supabase Auth (solo para superadmin y agencia)

---

# 3. MULTI-TENANCY (REGLA CENTRAL)

La identidad de aplicación se resuelve desde `public.users` después de validar
la sesión de Supabase Auth. Para usuarios AGENCY, `public.users.agency_id`
determina el tenant.

Reglas:

- El frontend nunca es fuente de autorización.
- Roles y `agency_id` provienen de `public.users`, no de `user_metadata`.
- Los flujos comerciales filtran por el `agencyId` confiable del request.
- SUPERADMIN opera sin filtro de agencia cuando el caso de uso lo requiere.
- Boarding usa la pertenencia del tenant al viaje como frontera operacional,
  según [ADR-001](decisions/ADR-001-boarding-cross-agency.md).

---

# 4. REQUEST LIFECYCLE (OBLIGATORIO)

Flujo protegido:

1. Validar el access token con Supabase Auth.
2. Resolver usuario, rol y agencia desde `public.users`.
3. Aplicar RBAC.
4. Validar estado del tenant.
5. Inyectar contexto:
   ```ts
   {
     userId,
     role,
     agencyId
   }
   ```
6. Controller.
7. Service layer con autorización comercial u operacional.
8. Acceso a datos.
9. Response.

---

# 5. ROLES

Roles finales del sistema:

- SUPERADMIN → control global.
- AGENCY → operador de un tenant.

IMPORTANTE:

- No existen roles `admin`, `customer` ni `user`.
- Los pasajeros no tienen rol ni login.

---

# 6. MODELO DE NEGOCIO

## Trips

Cada viaje tiene:

- route
- capacity total
- departure_time
- vehicle_type
- status

---

## Regla crítica

Un viaje NO puede existir sin agencias asignadas.

---

## Trip creation flow

1. Superadmin crea Trip
2. Debe asignar al menos 1 agencia
3. Cada agencia recibe una asignación en `trip_agencies`
4. Si no hay asignación → request inválido

---

## Distribución de capacidad

```
SUM(allocated_seats) <= trip.capacity
```

---

# 7. PUESTOS Y CAPACIDAD

El sistema mantiene puestos identificados por `seat_code` y layouts físicos
fijos según el tipo de vehículo.

- Los puestos controlan inventario y asignación de pasajeros.
- Pueden estar disponibles, bloqueados temporalmente, reservados o bloqueados
  operativamente.
- La capacidad y las asignaciones por agencia limitan las reservas.

---

# 8. AISLAMIENTO COMERCIAL Y OPERACIÓN COMPARTIDA

Una agencia no puede administrar ni listar reservas, pasajeros, cupos o
métricas comerciales de otras agencias. Todo acceso comercial se filtra en
backend por el contexto confiable de agencia.

Boarding es una excepción operacional: una agencia asignada mediante
`trip_agencies` puede consultar el contexto necesario y abordar pasajeros de
cualquier reserva del mismo viaje. Esta capacidad no concede permisos CRUD
sobre la reserva externa.

La regla completa está en
[ADR-001 — Boarding cross-agency](decisions/ADR-001-boarding-cross-agency.md).

---

# 9. BASE DE DATOS

La fuente de verdad del schema es `supabase/migrations/`, aplicada en orden. Los
modelos copiados en documentación no son normativos porque pueden quedar
obsoletos frente a constraints, columnas, funciones y políticas posteriores.

Referencias vigentes relevantes:

- Roles: `superadmin` y `agency` en `public.users`.
- Trip: `active`, `cancelled`, `completed`, `archived`.
- Reservation: `confirmed`, `cancelled`, `partial`, `completed`, `boarded`.
- Reservation passenger: `active`, `cancelled`, con boarding representado por
  `boarded` y `boarded_at`.
- Seats: consultar la constraint vigente en migraciones.
- Asignación de agencias a viajes: `trip_agencies`.

`trips.postponed_from` conserva la fecha previa cuando un viaje se posterga. No
representa un estado adicional del viaje.

Para cambios de schema se debe crear una nueva migración; este documento solo
describe semántica de alto nivel.

---

# 10. RESERVAS + QR FLOW

1. AGENCY crea una reserva propia con booker y pasajeros.
2. Backend valida asignación y cupos, reserva puestos y genera un QR de grupo.
3. El QR se entrega al booker.
4. Una agencia asignada al viaje presenta o escanea el QR en terminal.
5. Backend autoriza boarding mediante `trip_agencies`.
6. La agencia opera pasajeros activos del viaje.
7. Backend actualiza `boarded`, `boarded_at` y el estado agregado de la reserva.
8. Cada cambio crea un registro de boarding con actor y agencia operadora.

---

# 11. ENTRY ROUTE (/)

La ruta `/` redirige a `/login`.

No existe catálogo público, reserva pública, registro abierto ni portal de
pasajeros. El acceso autenticado está reservado para SUPERADMIN y AGENCY; las
cuentas de agencia se crean mediante los flujos administrativos y de
invitación autorizados.

---

# 12. DASHBOARDS

## Superadmin dashboard

- Visión global del sistema
- Viajes activos
- Agencias
- Asignaciones
- KPIs (reservas totales, pasajeros, etc.)

---

## Agency dashboard

- Solo viajes asignados
- Reservas, pasajeros y métricas comerciales propias
- Estado operacional de sus viajes
- Boarding compartido únicamente dentro del flujo autorizado

No existe dashboard para pasajeros.

---

# 13. SECURITY RULES

- Backend es la única capa confiable.
- Frontend no decide autorización ni aislamiento.
- La sesión identifica al usuario de Auth; rol y agencia se resuelven desde
  `public.users`.
- Los flujos comerciales validan `agency_id`.
- Boarding valida `trip_agencies`, estado del viaje y estado de
  reserva/pasajero.
- El uso de clientes privilegiados exige controles explícitos en servicios.

---

# 14. CRITICAL BUSINESS RULES

- SUM(allocated_seats) <= capacity
- reserved_seats <= allocated_seats
- Trip siempre tiene al menos 1 agency
- No existe estado "trip sin agencia"
- La propiedad comercial de una reserva no cambia durante boarding.
- Boarding cross-agency requiere asignación al viaje.
- Cada acción de boarding registra `board` o `unboard` con actor y agencia
  operadora.
- Acciones administrativas/operativas relevantes se registran en
  `audit_log` (append-only, F5-001); detalle: [`F5-001-audit-trail-design.md`](F5-001-audit-trail-design.md).

---

# 15. ARCHITECTURE GOAL

Sistema tipo SaaS real multi-tenant:

- Stripe-like (billing separation concept)
- Uber-like (dispatch logic)
- Airbnb-like (inventory splitting)

---

# 16. IMPLEMENTATION RULE

NO IMPLEMENTAR NADA SIN:

1. Validar este spec
2. Detectar inconsistencias
3. Proponer cambios antes de código

---

# END OF SPEC
