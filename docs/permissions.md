# Permisos

## SUPERADMIN

Acceso total e irrestricto a todas las entidades del sistema:

- agencies (CRUD)
- routes (CRUD)
- trips (CRUD + status)
- trip_agencies (CRUD)
- reservations (lectura + cancelación)
- passengers (lectura)
- boarding_logs (lectura)
- users (lectura)
- invitations (CRUD)
- audit_log (lectura — F5-001; append-only, sin mutación directa)

## AGENCY

Los permisos se dividen entre propiedad comercial y operación de viajes
compartidos.

### Permisos comerciales

- Crea, consulta y cancela reservas de su propia agencia.
- Consulta y cancela pasajeros de sus propias reservas.
- Consulta sus métricas, cupos y actividad comercial.
- No puede editar, cancelar ni cambiar el estado de reservas externas.
- No puede usar los endpoints administrativos de pasajeros o reservas para
  acceder a datos de otras agencias.

La propiedad comercial se determina por `reservation.agency_id`.

### Permisos sobre viajes

- Consulta viajes donde tiene asignación mediante `trip_agencies`.
- No puede crear, editar, cancelar, completar ni archivar viajes.
- La asignación al viaje no concede acceso administrativo a las reservas de
  otras agencias.

### Permisos operacionales de boarding

- Puede ejecutar lookup, abordar y desabordar pasajeros de cualquier reserva
  perteneciente a un viaje donde su agencia esté asignada.
- La autorización depende de `trip_agencies`, no de
  `reservation.agency_id`.
- El viaje debe haber salido y no puede estar `cancelled` ni `completed`.
- La reserva y el pasajero no pueden estar cancelados.
- El permiso solo habilita la información y las acciones necesarias para
  boarding; no permite modificar los datos comerciales de la reserva externa.
- La acción debe registrar el usuario y la agencia operadora.

### QR

- Fuera de boarding, una agencia solo consulta QR de sus reservas.
- Dentro del flujo de boarding puede buscar el QR de una reserva del viaje
  compartido y recibir el contexto operacional autorizado.
- Este acceso no habilita listados generales de QR externos.

### Boarding logs

- La trazabilidad diferencia la agencia propietaria de la reserva y la agencia
  que ejecutó el boarding.
- Una agencia no obtiene por esta excepción acceso general al historial
  administrativo de otra agencia.

### Audit log (F5-001)

- Tabla append-only `audit_log`: INSERT solo vía `audit_append` / service_role;
  sin UPDATE/DELETE.
- **Superadmin:** SELECT de todas las filas.
- **Agency:** SELECT únicamente donde `agency_id` coincide con su tenant
  (`private.auth_app_agency_id()`). No ve filas con `agency_id IS NULL`.
- El actor de escritura se toma del contexto autenticado del backend
  (`req.ctx`), nunca del body del cliente.
- No existe API/UI de lectura en F5-001; los permisos anteriores aplican a RLS
  cuando exista un consumidor autorizado.

## Regla clave

Toda autorización se hace EXCLUSIVAMENTE en backend.
El frontend NUNCA es fuente de seguridad.
La identidad se resuelve desde `public.users`; no desde metadata del JWT.

El aislamiento comercial se filtra por `agency_id`. La excepción operacional
de boarding se autoriza por pertenencia al viaje en `trip_agencies`, conforme a
[ADR-001](decisions/ADR-001-boarding-cross-agency.md).
