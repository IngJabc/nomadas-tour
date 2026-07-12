# Base de datos

---

## Agency

id
name
email
status

---

## Trip

id
routeId
capacity
departureDate

---

## TripAgencyAllocation

id
tripId
agencyId
allocatedCapacity
reservedCapacity

---

## Reservation

id
tripId
agencyId
customerName
status
qrCode

---

## Regla crítica

El backend siempre filtra por agencyId.

Nunca exponer datos globales a agencias.
