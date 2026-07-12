# Reglas de negocio

---

## Roles

Solo existen dos roles con acceso al sistema:

### SUPERADMIN

- Control total del sistema
- Crea rutas, viajes, asigna cupos a agencias

### AGENCY

- Opera viajes autorizados por superadmin
- Crea reservas para sus pasajeros
- Gestiona abordaje
- Solo ve sus propios datos

NO existe rol "customer" ni "user". Los pasajeros no inician sesión.

---

## Viajes

Cada viaje tiene:

- Ruta (origen → destino)
- Capacidad total (cupos disponibles)
- Precio global

El Superadmin asigna cupos a las agencias vía trip_agency_allocations.
SUM(allocated_seats) <= trip.capacity

---

## Cupos (no asientos físicos)

Los "asientos" son CUPOS VIRTUALES:

- Representan plazas disponibles en el viaje
- No representan ubicación física real
- El pasajero puede sentarse libremente
- Sirven exclusivamente para control de inventario

---

## Reservas

Una reserva representa un GRUPO de pasajeros bajo un mismo QR.

### Contiene

- Nombre de quien reserva (customer_name)
- QR único (compartido por todo el grupo)
- Múltiples pasajeros, cada uno con:
  - nombre
  - documento
  - teléfono
  - seat_code (cupo asignado)
  - boarding_status: pending | boarded

### Ejemplo

Reserva: Juan Pérez
QR: NT-SANTIAGO-ABC123

Pasajeros:
```
A1 | Juan Pérez    | pending
A2 | María García  | pending
A3 | Pedro López   | pending
```

---

## Abordaje

### Flujo

1. Agencia escanea QR de la reserva
2. El sistema muestra: viaje, nombre de quien reservó, total pasajeros, lista de plazas
3. La agencia marca las plazas que están abordando
4. El sistema registra la acción en boarding_logs

### Reglas

- No se muestran nombres de pasajeros durante el escaneo
- El QR es compartido por toda la reserva
- Se pueden hacer múltiples escaneos (abordaje parcial)
- Cada escaneo registra qué plazas se marcaron

### Ejemplo

Primera parada: se marcan A1, A2, A3 → 3/8 abordados
Segunda parada: se marcan A4, A5, A6, A7, A8 → 8/8 abordados

---

## Historial de abordaje

Cada acción de abordaje se registra en boarding_logs:

- transaction_id (UUID de la reserva)
- user_id (agente que escaneó)
- seat_codes (plazas marcadas)
- action: 'board' | 'correction'
- created_at

Permite correcciones manteniendo auditoría completa.

---

## Aislamiento

Una agencia NUNCA puede ver:

- Reservas de otras agencias
- Pasajeros de otras agencias
- QR de otras agencias
- Asignaciones de otras agencias
