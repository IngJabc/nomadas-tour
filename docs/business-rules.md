# Reglas de negocio

## Roles

Solo existen dos roles con acceso al sistema:

### SUPERADMIN

- Tiene control global del sistema.
- Administra agencias, rutas, viajes y asignaciones.
- Puede consultar y gestionar reservas de cualquier agencia.

### AGENCY

- Administra comercialmente sus propias reservas y pasajeros.
- Opera los viajes donde está asignada mediante `trip_agencies`.
- Puede ejecutar boarding del viaje compartido según
  [ADR-001](decisions/ADR-001-boarding-cross-agency.md).

No existen roles `admin`, `customer` ni `user`. Los pasajeros no inician
sesión.

## Viajes

Cada viaje tiene ruta, fecha de salida, capacidad, tipo de vehículo y estado.
Sus estados persistidos son:

- `active`
- `cancelled`
- `completed`
- `archived`

Un viaje puede estar asignado a varias agencias mediante `trip_agencies`. La
suma de sus cupos asignados no puede superar la capacidad del viaje.

Cuando un viaje se pospone, `postponed_from` conserva la fecha de salida
anterior. Solo se actualiza cuando la operación de edición se marca como
postergación y la fecha realmente cambia.

## Reservas

Una reserva agrupa pasajeros bajo un mismo QR y pertenece comercialmente a una
agencia mediante `agency_id`.

Estados persistidos de una reserva:

- `confirmed`: reserva activa sin abordajes.
- `partial`: parte de sus pasajeros activos fue abordada.
- `completed`: todos sus pasajeros activos fueron abordados.
- `boarded`: estado legado soportado por el schema.
- `cancelled`: reserva cancelada.

Los servicios pueden recalcular `confirmed`, `partial` o `completed` según el
boarding de los pasajeros activos. No todos los comandos aceptan transiciones
desde cualquier estado; cada flujo valida su subconjunto permitido.

### Cancelación de reserva

- Una agencia solo puede cancelar una reserva propia.
- El flujo de cancelación de agencia acepta reservas en estado `confirmed`.
- No se permite cancelar si el viaje está `cancelled` o `completed`.
- La cancelación cambia la reserva a `cancelled` y libera sus puestos.

### Reactivación

- La reactivación administrativa permitida es `cancelled → confirmed`.
- La transición inversa administrativa es `confirmed → cancelled`.
- Reactivar la cabecera de una reserva no reactiva pasajeros cancelados ni
  reconstruye automáticamente sus puestos; esos registros conservan su estado.

## Pasajeros

Estados persistidos:

- `active`
- `cancelled`

El boarding se representa además mediante `boarded` y `boarded_at`.

### Cancelación individual

- Solo la agencia propietaria de la reserva puede cancelar uno de sus
  pasajeros.
- La reserva y el pasajero no pueden estar ya cancelados.
- No se permite modificar pasajeros si el viaje está `cancelled` o
  `completed`.
- Cancelar un pasajero lo cambia a `cancelled`, limpia su boarding y libera su
  puesto.
- El estado de la reserva se recalcula usando únicamente pasajeros activos.
- Si no queda ningún pasajero activo, la reserva se cancela automáticamente.

## Boarding

Boarding es una operación del viaje y constituye una excepción acotada al
aislamiento comercial.

1. La agencia presenta o escanea el QR.
2. El backend obtiene el viaje de la reserva.
3. La autorización verifica que la agencia operadora pertenezca al viaje
   mediante `trip_agencies`.
4. La agencia puede abordar o desabordar pasajeros activos de cualquier reserva
   de ese viaje, aunque otra agencia sea la propietaria comercial.
5. Cada cambio actualiza el estado agregado de la reserva y registra la acción.

No se permite boarding antes de la salida ni en viajes `cancelled` o
`completed`. Tampoco se permite sobre reservas o pasajeros cancelados.

La interfaz debe limitar la información mostrada a los datos operacionales
necesarios. Los riesgos de PII y lookup parcial están documentados en
[ADR-001](decisions/ADR-001-boarding-cross-agency.md).

## Historial de boarding

Cada cambio registra, entre otros datos:

- reserva y pasajero afectados;
- usuario que ejecutó la acción;
- agencia operadora (`scanned_by_agency_id`);
- acción `board` o `unboard`;
- puestos afectados;
- fecha de ejecución.

La agencia operadora puede ser distinta de la agencia propietaria de la
reserva.

## Aislamiento comercial y excepción operacional

Una agencia no puede administrar, listar, modificar ni cancelar reservas o
pasajeros de otras agencias. Tampoco obtiene acceso general a sus métricas,
cupos o asignaciones.

La excepción es el flujo de boarding: una agencia asignada al viaje puede
consultar la información operacional necesaria y cambiar el estado de boarding
de pasajeros del mismo viaje. Esta capacidad no transfiere propiedad comercial
ni habilita otros endpoints sobre datos externos.

Fuente normativa: [ADR-001 — Boarding cross-agency](decisions/ADR-001-boarding-cross-agency.md).
