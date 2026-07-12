# SYSTEM SPEC — MULTI-TENANT TRAVEL PLATFORM

Este documento define la arquitectura completa del sistema antes de cualquier implementación.

NO implementar nada sin seguir este spec.

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

El sistema es multi-tenant basado en subdominios.

Ejemplo:

```
expres.tuapp.com → agencyId = 12
```

Reglas:

- Todo request debe resolver tenant desde subdominio
- Toda query debe filtrar por agencyId (excepto superadmin)
- Frontend nunca es fuente de seguridad

---

# 4. REQUEST LIFECYCLE (OBLIGATORIO)

Flujo de cualquier request:

1. Resolve tenant (subdomain → agencyId)
2. Authenticate JWT
3. Apply RBAC
4. Inject context:
   ```ts
   {
     userId,
     role,
     agencyId,
     tenantId
   }
   ```
5. Controller
6. Service layer
7. Repository layer (FILTERED QUERY)
8. Response

---

# 5. ROLES

Roles finales del sistema:

- superadmin → control total
- agency → operador multi-tenant

IMPORTANTE:

- NO existe rol "customer" ni "user"
- NO existe rol "admin"
- "agency" reemplaza cualquier admin anterior
- Los pasajeros NO tienen rol ni login

---

# 6. MODELO DE NEGOCIO

## Trips

Cada viaje tiene:

- route
- capacity total
- price global (definido por superadmin)

---

## Regla crítica

Un viaje NO puede existir sin agencias asignadas.

---

## Trip creation flow

1. Superadmin crea Trip
2. Debe asignar al menos 1 agencia
3. Cada agencia recibe cupos
4. Si no hay asignación → request inválido

---

## Distribución de capacidad

```
SUM(allocated_seats) <= trip.capacity
```

---

# 7. CORE CONCEPTO: CUPOS (NO ASIENTOS FÍSICOS)

El sistema NO maneja asientos físicos.

Los "asientos" son CUPOS VIRTUALES.

- Sirven solo para control de inventario
- No representan ubicación real en el bus
- El pasajero puede sentarse libremente

---

# 8. AISLAMIENTO DE AGENCIAS (CRÍTICO)

Una agencia NUNCA puede ver:

- otras agencias
- reservas de otras agencias
- pasajeros de otras agencias
- QR de otras agencias
- cupos de otras agencias
- boarding_logs de otras agencias
- métricas globales

Todo debe filtrarse en backend.

---

# 9. BASE DE DATOS (SUPABASE SCHEMA)

## users

Solo para superadmin y agencias.

```sql
- id              UUID PK (1:1 auth.users)
- email           TEXT
- role            'superadmin' | 'agency'
- agency_id       UUID FK → agencies (nullable)
- full_name       TEXT
```

---

## agencies

```sql
- id              UUID PK
- name            TEXT
- subdomain       TEXT UNIQUE
- email           TEXT
- phone           TEXT
- status          'active' | 'inactive'
- created_by      UUID FK → auth.users
```

---

## routes

```sql
- id              UUID PK
- origin          TEXT
- destination     TEXT
- created_by      UUID FK → auth.users
```

---

## trips

```sql
- id              UUID PK
- route_id        UUID FK → routes
- departure_time  TIMESTAMPTZ
- capacity        INT
- price           NUMERIC
- vehicle_type    'bus' | 'kia'
- status          'active' | 'cancelled' | 'completed'
- postponed_from  TIMESTAMPTZ (nullable)
- created_by      UUID FK → auth.users
```

---

## trip_agency_allocations

```sql
- id              UUID PK
- trip_id         UUID FK → trips
- agency_id       UUID FK → agencies
- allocated_seats INT (>0)
- reserved_seats  INT (>=0)
```

UNIQUE(trip_id, agency_id)

---

## seats

```sql
- id              UUID PK
- trip_id         UUID FK → trips
- seat_code       TEXT (A1, A2...)
- status          'available' | 'locked' | 'reserved' | 'blocked' | 'guide'
- locked_by       UUID FK → auth.users (nullable)
- locked_at       TIMESTAMPTZ (nullable)
```

UNIQUE(trip_id, seat_code)

---

## reservations (HEADER)

Una reserva es un grupo de pasajeros bajo un mismo QR.

```sql
- id               UUID PK
- trip_id          UUID FK → trips
- agency_id        UUID FK → agencies
- transaction_id   TEXT UUID (único por grupo)
- customer_name    TEXT (quién reserva)
- phone            TEXT
- total_passengers INT
- status           'confirmed' | 'cancelled'
- qr_code          TEXT (único por grupo)
- created_at       TIMESTAMPTZ
```

---

## passengers

Cada fila es un pasajero individual dentro de una reserva.

```sql
- id               UUID PK
- transaction_id   TEXT UUID FK → reservations.transaction_id
- trip_id          UUID FK → trips
- agency_id        UUID FK → agencies
- seat_code        TEXT (cupo asignado, ej: A1)
- full_name        TEXT
- document         TEXT (cédula)
- phone            TEXT
- boarding_status  'pending' | 'boarded'
- created_at       TIMESTAMPTZ
```

---

## boarding_logs

Registro de auditoría para cada acción de abordaje.

```sql
- id               UUID PK
- transaction_id   TEXT UUID FK → reservations.transaction_id
- trip_id          UUID FK → trips
- agency_id        UUID FK → agencies
- scanned_by       UUID FK → users
- seat_codes       TEXT[] (plazas marcadas en esta acción)
- action           'board' | 'correction'
- created_at       TIMESTAMPTZ
```

---

## agency_invitations

```sql
- id              UUID PK
- token           TEXT UNIQUE
- agency_id       UUID FK → agencies
- email           TEXT
- created_by      UUID FK → auth.users
- expires_at      TIMESTAMPTZ
- used_at         TIMESTAMPTZ (nullable)
- used_by         UUID FK → auth.users (nullable)
```

---

# 10. RESERVAS + QR FLOW

1. Agencia crea reserva (customer_name + lista de pasajeros)
2. Backend asigna cupos, genera QR, inserta reservation header + filas en passengers
3. QR se entrega al pasajero
4. Agencia escanea QR en terminal
5. Sistema muestra: viaje, customer_name, total pasajeros, plazas con checkbox
6. Agencia selecciona plazas abordadas
7. Backend actualiza boarding_status en passengers + registra boarding_log
8. Múltiples escaneos hasta que todos estén boarded

---

# 11. LANDING PAGE (/)

Catálogo público de viajes disponibles.

Muestra:
- ruta
- fecha
- precio
- cupos disponibles

NO requiere autenticación.
NO muestra agencias, distribución interna ni asignaciones.

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
- Solo sus reservas
- Solo sus pasajeros
- Estado de abordajes

NO existe dashboard de customer.

---

# 13. SECURITY RULES

- Backend es la única capa confiable
- Frontend nunca filtra datos sensibles
- Todas las queries deben validar agency context
- JWT siempre incluye role + agencyId (si aplica)

---

# 14. CRITICAL BUSINESS RULES

- SUM(allocated_seats) <= capacity
- reserved_seats <= allocated_seats
- Trip siempre tiene al menos 1 agency
- No existe estado "trip sin agencia"
- boarding_logs es append-only (nunca se eliminan registros)
- Las correcciones de abordaje son nuevos registros con action='correction'

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
