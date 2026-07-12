# Permisos

---

## SUPERADMIN

Acceso total e irrestricto a todas las entidades del sistema:

- agencies (CRUD)
- routes (CRUD)
- trips (CRUD + status)
- trip_agency_allocations (CRUD)
- reservations (lectura + cancelación)
- passengers (lectura)
- boarding_logs (lectura)
- users (lectura)
- invitations (CRUD)

---

## AGENCY

Solo puede acceder a datos de su propia agencia.

### Viajes

- Lectura: solo viajes donde tiene asignación (trip_agency_allocations)
- NO puede crear, modificar ni eliminar viajes

### Reservas

- Creación: sí, para sus pasajeros
- Lectura: solo sus propias reservas
- Cancelación: sí, de sus propias reservas
- NO puede ver reservas de otras agencias

### Pasajeros

- Lectura: solo pasajeros de sus propias reservas
- NO puede ver pasajeros de otras agencias

### Abordaje

- Ejecución: sí, sobre sus propias reservas
- Lectura de boarding_logs: solo los suyos

### QR

- Lectura: solo QR de sus propias reservas

---

## Regla clave

Toda autorización se hace EXCLUSIVAMENTE en backend.
El frontend NUNCA es fuente de seguridad.
Todos los filtros de tenant se aplican en la capa de servicio, no en la UI.
