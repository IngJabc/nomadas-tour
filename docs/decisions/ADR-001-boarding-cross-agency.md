# ADR-001 — Boarding cross-agency en viajes compartidos

## Status

Accepted

Fecha de decisión: 2026-08-04.

## Contexto

Nómadas Tour es una plataforma multi-tenant donde cada agencia conserva la
propiedad comercial de sus reservas. Esa propiedad determina quién puede crear,
consultar, modificar o cancelar una reserva y protege los datos comerciales
mediante `agency_id`.

Un viaje, sin embargo, puede estar asignado simultáneamente a varias agencias
mediante `trip_agencies`. Cuando esas agencias comparten el mismo vehículo y la
misma salida, el boarding es una operación del viaje, no una acción comercial
sobre la reserva. En el punto de embarque puede ser necesario que cualquiera de
las agencias operadoras valide a todos los pasajeros del viaje, aunque la
reserva haya sido vendida por otra agencia asignada.

La implementación actual refleja esa frontera operacional:

- `lookupPassengerByQR` busca la reserva y solo devuelve resultados cuando la
  agencia que escanea pertenece al viaje.
- `toggleBoarding` obtiene el viaje del pasajero y delega la autorización en
  `validateBoardingAllowed`.
- `validateBoardingAllowed` exige que la agencia esté asignada mediante
  `trip_agencies`, que el viaje haya salido y que no esté cancelado ni
  completado.
- La autorización no compara la agencia operadora con
  `reservation.agency_id`.
- Cada cambio registra el usuario, la agencia operadora y el pasajero afectado
  en `boarding_logs`.

Esto contradice documentos anteriores que describen el aislamiento de tenant
como absoluto incluso durante el boarding. Se requiere distinguir formalmente
el aislamiento comercial de la colaboración operacional dentro de un viaje
compartido.

## Decisión

Se adopta la **Opción A: mantener boarding cross-agency**.

La regla oficial es:

- Una agencia administra únicamente sus propias reservas.
- La propiedad comercial y las operaciones CRUD sobre reservas permanecen
  aisladas por `reservation.agency_id`.
- Una agencia asignada a un viaje puede consultar la información operacional
  necesaria para boarding y abordar o desabordar pasajeros pertenecientes a
  cualquier reserva de ese mismo viaje.
- La autorización de boarding depende de la relación `trip_agencies`, además
  del estado y la hora de salida del viaje.
- Este permiso es una excepción operacional acotada. No concede acceso general
  a reservas, pasajeros, métricas, cupos ni asignaciones de otras agencias.

La Opción B se rechaza porque obligaría a que cada agencia mantenga un punto de
control separado durante un viaje compartido, aumentaría la fricción en el
embarque y no coincide con el flujo actualmente implementado.

## Consecuencias

### Seguridad

- La pertenencia al viaje se convierte en una frontera de autorización
  adicional y explícita para boarding.
- Una agencia asignada obtiene capacidad de escritura sobre el estado de
  boarding de pasajeros que no son comercialmente suyos.
- Los controles de aplicación son críticos porque estos servicios usan acceso
  privilegiado y no dependen exclusivamente de RLS.
- Toda acción cross-agency debe ser atribuible al usuario y a la agencia que la
  ejecutó.
- El alcance de datos devuelto por el lookup debe revisarse y mantenerse en el
  mínimo necesario para la operación.

### Multi-tenancy

- El aislamiento continúa siendo estricto para administración comercial,
  listados, métricas y mantenimiento de reservas.
- Boarding constituye una excepción de dominio basada en un recurso compartido:
  el viaje.
- `trip_agencies` expresa autorización operacional; `reservation.agency_id`
  continúa expresando propiedad comercial.

### Operación

- Un único punto de embarque puede procesar pasajeros de todas las agencias
  participantes.
- Se evita bloquear el boarding cuando la agencia propietaria de una reserva no
  tiene personal presente.
- Dos agencias pueden operar simultáneamente sobre el mismo viaje, por lo que
  concurrencia, idempotencia y trazabilidad deben conservarse como requisitos.

### Funcionalidades futuras

- Roles operacionales más específicos, como operador de terminal o agente de
  boarding, deberán heredar permisos desde el viaje y no desde la propiedad de
  la reserva.
- El Audit Trail deberá registrar actor, agencia operadora, agencia propietaria,
  viaje, pasajero y transición antes/después.
- Reportes y notificaciones deberán diferenciar entre la agencia propietaria de
  la reserva y la agencia que ejecutó el boarding.
- Cualquier API pública, integración o aplicación móvil deberá aplicar esta
  misma frontera y no reinterpretar boarding como CRUD comercial.

## Reglas derivadas

1. `reservation.agency_id` define la agencia propietaria de la reserva.
2. Solo la agencia propietaria puede crear, editar, cancelar o consultar una
   reserva mediante los flujos administrativos normales.
3. `trip_agencies` define qué agencias pueden operar el boarding de un viaje
   compartido.
4. Una agencia asignada puede hacer lookup y cambiar el estado de boarding de
   cualquier pasajero activo del viaje, aunque pertenezca a otra agencia.
5. El permiso cross-agency existe únicamente dentro de endpoints y pantallas de
   boarding; no habilita listados generales ni navegación sobre datos ajenos.
6. No se permite boarding antes de la salida ni cuando el viaje está cancelado
   o completado.
7. No se permite boarding de pasajeros o reservas canceladas.
8. Cada acción debe registrar al usuario ejecutor y su agencia operadora, sin
   sustituir la identidad de la agencia propietaria.
9. La interfaz de boarding debe mostrar solo la información operacional
   necesaria y no reutilizar DTOs administrativos de reservas.
10. `docs/business-rules.md`, `docs/permissions.md` y `docs/system-spec.md`
    deberán referenciar este ADR al describir la excepción de boarding.

## Consideraciones de seguridad

### Datos que permanecen aislados

- Administración y listados de reservas.
- Creación, edición y cancelación de reservas.
- Métricas comerciales y operativas propias de cada agencia.
- Cupos, asignaciones y pasajeros fuera del flujo autorizado de boarding.
- Historial administrativo que no sea necesario para operar el viaje.

### Información operacional compartida

La implementación actual puede exponer durante el lookup datos de la reserva,
agencia propietaria, viaje, plazas y estado de boarding. También incluye datos
personales del booker y de pasajeros. Esta exposición no debe interpretarse como
permiso general de lectura: está vinculada al lookup de boarding y a la
asignación de la agencia al viaje.

Como hardening posterior se debe revisar el DTO para reducir PII a la mínima
información requerida por la operación, especialmente nombres y documentos
individuales.

### Permisos requeridos

Para ejecutar boarding, una solicitud debe:

1. estar autenticada como usuario vigente de una agencia activa;
2. resolver la agencia desde el contexto confiable del backend;
3. pertenecer a un viaje mediante `trip_agencies`;
4. operar sobre un pasajero de ese mismo viaje;
5. respetar estado, horario y cancelaciones;
6. dejar registro auditable del actor y de la agencia operadora.

### Riesgos conocidos

- `lookupPassengerByQR` usa actualmente coincidencia parcial, lo que aumenta el
  riesgo de enumeración y debe evaluarse frente a una coincidencia exacta.
- El payload actual contiene más PII de la necesaria para un scanner de
  boarding.
- Una referencia de pasajero conocida permite intentar `toggleBoarding`; la
  pertenencia al viaje sigue siendo el control de autorización determinante.
- Agencias concurrentes pueden intentar modificar el mismo estado de boarding.
- La capacidad de desabordar pasajeros cross-agency requiere la misma
  trazabilidad y controles que el abordaje.

Estos riesgos no cambian la decisión de dominio, pero deben tratarse como
hallazgos de seguridad y privacidad antes de ampliar el flujo a nuevos canales.
