# Arquitectura General

## Tipo de sistema

Plataforma SaaS multi-tenant B2B para gestión de viajes, reservas, pasajeros y abordaje.
NO maneja pagos ni ventas.

---

## Arquitectura lógica

Frontend (Next.js) → Backend API (Node.js + Express) → Supabase (DB + Auth)

---

## Principios

- Toda lógica de negocio vive en el backend
- Todo acceso a datos está filtrado por agencyId o role
- Los pasajeros NO tienen usuario ni acceso al sistema
- Cada acción de abordaje queda registrada con auditoría

---

## Separación de dominios

### Superadmin domain

- Gestión global del sistema
- Rutas, viajes, agencias, asignación de cupos

### Agency domain

- Solo ve sus viajes autorizados
- Solo crea y gestiona sus propias reservas
- Solo ve sus propios pasajeros
- Controla abordaje de sus reservas

### Boarding domain

- Registro de auditoría por cada acción de abordaje
- Permite correcciones manteniendo trazabilidad

---

## Concepto clave

El sistema maneja CUPOS VIRTUALES, no asientos físicos.
Cada reserva agrupa múltiples pasajeros bajo un mismo QR.
