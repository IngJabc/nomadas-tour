# AUD-020 — Boarding cross-agency: seguridad y consistencia de dominio

**Tipo:** Auditoría de código (solo análisis, sin modificaciones)
**Fecha:** 2026-08-04
**Referencia:** [ADR-001 — Boarding cross-agency en viajes compartidos](decisions/ADR-001-boarding-cross-agency.md) (Accepted)
**Alcance:** Autorización operacional, exposición de PII, seguridad del QR, concurrencia/idempotencia, auditoría, consistencia de dominio y cobertura de tests de las rutas de boarding de agencia.

---

## 1. Resumen ejecutivo

La ruta de boarding por pasajero individual de Sprint 13 (`GET/PATCH /agency/boarding/*`) implementa correctamente la decisión del ADR-001 en la capa de aplicación: la autorización se delega en `validateBoardingAllowed`, que exige la relación `trip_agencies`, el estado del viaje y el horario de salida; cada acción registra actor (`scanned_by`), agencia operadora (`scanned_by_agency_id`) y pasajero (`reservation_passenger_id`). No se encontró bypass de superadmin ni debilitamiento del guard en las rutas auditadas.

El problema principal no está en la ruta nueva sino en la **coexistencia de tres endpoints legacy que contradicen el ADR**: `/agency/reservations/board`, `/agency/scanner/board` y `/agency/scanner/lookup` siguen filtrando por `reservation.agency_id` (propiedad comercial), por lo que una agencia asignada a un viaje compartido **no puede** abordar pasajeros de reservas ajenas por esas rutas. Son código muerto en el frontend actual, pero permanecen expuestos por HTTP. Se suman huecos de auditoría en esos endpoints, un DTO de lookup con más PII de la necesaria y coincidencia parcial, actualizaciones no transaccionales sin idempotencia, y una capa RLS anclada a la propiedad comercial que no refleja la excepción operacional.

La decisión de dominio es correcta y el flujo principal está bien construido; la implementación queda por debajo del nivel exigido por el ADR en trazabilidad, concurrencia y límite del alcance de datos.

---

## 2. Hallazgos

| ID | Severidad | Hallazgo | Evidencia |
|----|-----------|----------|-----------|
| H1 | **Alta** | Endpoints legacy de boarding filtran por `agency_id` (ownership comercial), no por `trip_agencies`. Una agencia asignada a un viaje compartido no puede abordar pasajeros de reservas de otra agencia vía `/agency/reservations/board`, `/agency/scanner/board` ni `/agency/scanner/lookup`. Contradice la regla 4 del ADR-001. **Mitigante:** el frontend solo usa la ruta de Sprint 13 (`app/agency/scan/page.tsx:195,399,448`); `boardPassenger` no se invoca desde el cliente. Falla seguro (error de ownership), pero el comportamiento es contrario a la decisión. | `backend/src/services/reservation.service.ts:48-50, 467-473, 507-512` · `backend/src/routes/agency/index.ts:21,32,33` |
| H2 | **Media** | Auditoría incompleta en endpoints legacy: `boardPassenger` y `boardPassengers` insertan en `boarding_logs` solo `reservation_id`, `scanned_by`, `action`, `seat_ids`, sin `scanned_by_agency_id` ni `reservation_passenger_id` (columnas existentes desde la migración 018). La ruta de Sprint 13 sí las escribe. | `backend/src/services/reservation.service.ts:124-131` y `572-579` vs `715-724` · `supabase/migrations/018_boarding_agency_audit.sql` |
| H3 | **Media** | `lookupPassengerByQR` usa coincidencia parcial `.ilike('qr_code', '%...%')`, por lo que acepta fragmentos arbitrarios del identificador. La búsqueda manual es una capacidad operacional esperada, no una vulnerabilidad por sí misma: el riesgo aparece cuando la consulta permite substrings desconocidos en vez de resolver un `ticket_code` completo o un `qr_code` completo por igualdad exacta. El DTO también devuelve `booker_document`, nombres y documentos individuales de pasajeros (`buildLookupDetail`). Además, el lookup solo valida `status` del viaje (cancelled/completed), no `departure_time`: expone PII de pasajeros de viajes aún no salidos, aunque el boarding esté bloqueado por el guard. | `backend/src/services/reservation.service.ts:645-664, 611, 619-641, 630-632` · ADR-001 §"Riesgos conocidos", regla 9 |
| H4 | **Media** | Concurrencia e idempotencia insuficientes: `toggleBoarding` es una secuencia read → update → recompute status → update → insert log **sin transacción ni lock**. Dos agencias operando el mismo viaje (caso previsto por el ADR) pueden togglear el mismo pasajero de forma concurrente: cada write sobreescribe `boarded_at` y crea un `boarding_logs` duplicado. `boardPassengers` tiene la misma ventana de carrera entre el check `alreadyBoarded` y el update. | `backend/src/services/reservation.service.ts:666-726, 529-543` · ADR-001 §"Operación" y regla 8 |
| H5 | **Media** | Estado de asientos inconsistente entre flujos: `boardPassenger` (legacy) marca `seats.status = 'blocked'` tras abordar; `toggleBoarding` (flujo vigente) no toca `seats` (queda `reserved`); `cancelPassenger` lo devuelve a `available`. Misma acción de dominio (abordar) deja distinto estado de asiento según el endpoint usado. | `backend/src/services/reservation.service.ts:117-120, 683-686, 768` |
| H6 | **Baja-Media** | RLS desalineada con la frontera operacional: `rp_agency_read`, `bl_agency_read` y `bl_agency_insert` anclan el acceso a `reservations.agency_id = auth agency` (propiedad comercial), no a `trip_agencies`. No es un bypass (el backend usa service role), pero: (a) los logs cross-agency escritos por `toggleBoarding` no serán legibles por la agencia operadora vía cliente/realtime; (b) realtime de `reservation_passengers` no entrega filas de otras agencias a una agencia asignada; (c) cualquier integración futura que use el JWT de cliente (no service role) rompería el boarding cross-agency. | `supabase/migrations/039_rls_identity_from_public_users_v2.sql:469-545` |

### Aclaración funcional de H3

El scanner necesita búsqueda manual porque un operador puede no tener
disponible el QR físico. El producto reconoce únicamente dos identificadores:

1. **Código corto del boleto:** `ticket_code` con formato fijo de ocho
   caracteres hexadecimales.
2. **QR completo:** valor íntegro persistido en `qr_code`.

Ambos se resuelven mediante coincidencia exacta. El contrato esperado debe:

- aplicar `trim` al input;
- normalizar a mayúsculas;
- validar `ticket_code` con formato hexadecimal fijo de ocho caracteres;
- consultar `ticket_code = input` o `qr_code = input`;
- eliminar `ILIKE '%input%'`, substrings y comodines;
- no buscar por destino, ruta ni fragmentos del identificador.

Ejemplos permitidos:

```text
6BBD52E9
→ encuentra el boleto por ticket_code exacto

NT-LA OLLA-6BBD52E983AB495493EAEE20466C18A2
→ encuentra el boleto por qr_code exacto
```

Ejemplos no permitidos:

```text
6BBD
BBD52
495493
LA OLLA
OLL
52E9
→ no devuelven resultados
```

La remediación no consiste en prohibir la búsqueda manual, sino en restringirla
a identificadores completos conocidos.

---

## 3. Riesgos residuales

- **Enumeración por búsqueda parcial de identificadores** (H3): aceptar fragmentos permite consultar repetidamente el espacio de códigos y descubrir coincidencias no conocidas previamente. El riesgo desaparece cuando el lookup se limita a un `ticket_code` completo o un `qr_code` completo. El control no es eliminar la búsqueda manual, sino impedir consultas parciales, comodines y búsquedas por atributos del viaje.
- **PII pre-salida** (H3): el lookup entrega datos personales de viajes que aún no han salido; la decisión del ADR habilita el acceso operacional, pero no antes de la ventana de embarque.
- **Eventos duplicados** (H4): dos agencias concurrentes generan logs y eventos realtime repetidos sobre el mismo pasajero, degradando la trazabilidad exigida por el ADR.
- **Superficie HTTP divergente** (H1): los tres endpoints legacy siguen operativos; un cliente futuro que los use reinterpretará el boarding como CRUD comercial, reviviendo la contradicción del ADR.
- **RLS como capa débil** (H6): la frontera operacional vive solo en la capa de aplicación; la capa de datos no la refleja, por lo que cualquier vía de acceso que no pase por el backend (realtime, futuras APIs con client JWT) queda sin la excepción.

---

## 4. Cobertura de tests

| Área | Cobertura | Observación |
|------|-----------|-------------|
| `validateBoardingAllowed` (guard) | **Sí** — 9 casos (permite activo/salido/asignado; rechaza futuro, cancelado, completado, no encontrado, no asignada) | `backend/src/services/boarding.guard.test.ts:48-115` |
| `toggleBoarding` (flujo vigente) | **No** | Sin archivo `reservation.service.test.ts` |
| `lookupPassengerByQR` / `buildLookupDetail` | **No** | — |
| `boardPassenger` / `boardPassengers` (legacy) | **No** | — |
| Escritura de `boarding_logs` (actor, agencia, pasajero) | **No** | No hay aserción sobre los campos insertados |
| RLS / realtime cross-agency | **No** | No hay tests de políticas |
| Consistencia `seats.status` tras boarding | **No** | — |

No existen tests unitarios ni de integración para `reservation.service.ts`; el guard es la única pieza del dominio con cobertura directa.

---

## 5. Conclusión

**Score de implementación: 6.5 / 10** (aprobable con reservas).

La ruta cross-agency implementada (Sprint 13) cumple la decisión del ADR-001 en su capa crítica: autorización por `trip_agencies`, guard de estado/horario, y trazabilidad completa (actor + agencia operadora + pasajero). No se encontraron vulnerabilidades de autorización explotables en el flujo vigente.

La calificación baja por los desvíos de consistencia: tres endpoints legacy que contradicen la regla oficial, auditoría incompleta en esos mismos endpoints, DTO de lookup por encima del mínimo operacional con búsqueda parcial de identificadores, ausencia de idempotencia/concurrencia en un escenario que el propio ADR define como de operación simultánea, estado de asientos divergente entre flujos y una capa RLS que no reconoce la excepción operacional.

La búsqueda manual continúa siendo una funcionalidad válida del scanner. La
remediación consiste en convertirla en lookup exacto: el operador puede
introducir el código corto completo o el QR completo, pero ningún fragmento
debe producir resultados.

**Recomendación de siguiente paso (fuera de alcance de este reporte):** tratar estos hallazgos como backlog de endurecimiento — no requieren revertir la decisión de dominio, sino consolidar la superficie de boarding en un único flujo coherente con el ADR y cubrirlo con tests.

---

### Anexo — Método

- Revisión estática de: `backend/src/services/boarding.guard.ts`, `backend/src/services/reservation.service.ts`, `backend/src/controllers/reservation.controller.ts`, `backend/src/routes/agency/index.ts`, `backend/src/routes/superadmin/index.ts`, `backend/src/services/boarding.guard.test.ts`, `supabase/migrations/039_rls_identity_from_public_users_v2.sql`, `supabase/migrations/018_boarding_agency_audit.sql`, `lib/api.ts`, `app/agency/scan/page.tsx`.
- Verificación del uso real de los endpoints en el frontend (grep en `lib/` y `app/`).
- Confirmación de que los servicios usan `supabaseAdmin` (service role) en lookups, guard y escrituras, por lo que la autorización de boarding reside en la capa de aplicación.
