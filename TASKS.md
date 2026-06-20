> El agente toma la primera tarea con estado [ ] , la ejecuta,
> y cambia [ ] por [x] al terminar. Una tarea a la vez.

---

## En progreso

<!-- El agente mueve aquí la tarea que está ejecutando -->

---

## Pendientes

<!-- Las tareas pendientes se listan aquí -->

---

## Completadas

### [x] Login / Pantalla de entrada

Rediseño completo de /login:
- Layout dos columnas 50/50 en desktop (hero + formulario), solo formulario en mobile
- Hero izquierdo: gradiente dark→navy, logo "N" Montserrat 900 80px con barra cyan,
  tagline Poppins 400 18px, 3 features con íconos SVG cyan + microcopy, montañas SVG decorativas
- Formulario derecho: labels visibles Poppins 500 12px uppercase, inputs con íconos
  (sobre email, toggle ojo password), focus con box-shadow cyan
- Botón cyan full-width 48px con hover blue y spinner loading
- "¿Olvidaste tu contraseña?" link, separador "o", link registro
- "← Volver al inicio" arriba del título
- Animación fadeIn+slideUp con framer-motion

### [x] Registro de usuario

Reescritura completa de /register:
- Mismo hero izquierdo que Login (gradiente, logo N, tagline, features, montañas SVG)
- Formulario con campos: Nombre completo (persona icon), Email (sobre), Contraseña (candado+eye toggle), Confirmar contraseña (candado+eye toggle)
- Indicador de fortaleza de 4 segmentos (débil rojo → fuerte verde), visible al escribir
- Checkbox de Términos y Condiciones + Política de Privacidad
- Botón "Crear cuenta" deshabilitado hasta aceptar términos
- Footer "¿Ya tienes cuenta? Inicia sesión"
- Animación fadeIn+slideUp con framer-motion

### [x] Dashboard "Mis reservas"

Reescritura completa de /dashboard:
- Fondo #f1f5f9, max-width 1100px centrado, padding 32px 24px
- Saludo "Hola, [nombre] 👋" Montserrat 800 26px con nombre desde auth metadata
- Empty state: tarjeta blanca centrada con ilustración SVG de bus, título, subtexto, CTA cyan
- ReservationCards: bookings agrupados por viaje, franja superior 4px de color según estado
- Badge pill (Activa/Cancelada), ruta Poppins 600 17px, fecha formateada con date-fns/es,
  asientos listados, precio total Montserrat 800 22px cyan
- "Ver detalles" y "Cancelar reserva" visibles según estado
- Responsive: apilamiento vertical en mobile

### [x] Panel Admin (Viajes y Rutas)

Rediseño completo de /admin, /admin/trips, /admin/routes:
- Sidebar izquierdo fijo 220px, fondo --color-brand-dark (#071946)
- Sidebar: logo N 24px, badge "Panel Admin", navegación Viajes/Rutas, "Volver al sitio"
- Ítem activo: border-left 3px cyan, fondo rgba(255,255,255,0.08)
- Mobile: drawer con overlay
- Área contenido: fondo #f1f5f9, breadcrumb, título Montserrat 800 24px
- Botón "+ Nuevo viaje" cyan, border-radius 10px
- Tabla: header #f8fafc / Poppins 600 12px uppercase muted
  Filas padding 16px 20px, border-bottom 1px #f1f5f9
  Badges pill (Activo: #ecfdf5/#059669, Inactivo: #f1f5f9/#6b7280)
  Botón Editar: #eff6ff text blue, Eliminar: #fef2f2 text #ef4444, border-radius 8px
- Inline create form en rutas: tarjeta blanca, labels uppercase, inputs con focus cyan
- Modal de confirmación en eliminar con overlay blur
- Admin homepage con 3 cards métricas + links de acceso rápido con border-left cyan

### [x] Página de selección de asientos (mejoras)

Rediseño completo de /trips/[id]:
- Navbar oculto en rutas /trips/; reemplazado por header personalizado sticky
  Fondo --color-brand-navy, "← Volver a viajes", ruta centrada, nav links
- Fondo página #f1f5f9
- Alert "Necesitas iniciar sesión" solo renderizado si NO autenticado
  (regla AGENTS.md: no mostrar si ya autenticado)
  Estilo: #fffbeb bg, border #fcd34d, ⚠️ icon, texto #92400e
- SeatLegend encima del bus con puntos 10px, Poppins 400 13px muted
- BusLayout: bus body --color-brand-dark, border-radius 20px
  Labels "FRENTE" (volante SVG) y "FONDO" fuera del bus, Poppins 600 11px uppercase 0.4 opacidad
- Seat.tsx colores planos (sin gradientes):
  Disponible: #088eb8 | Seleccionado: #f59e0b | Reservado: #374151/#6b7280
  Bloqueado: #7c3aed opacidad 0.7 | Guía: #071946 + border 2px #088eb8
  Disponible hover: scale(1.05), box-shadow 0 4px 12px rgba(8,142,184,0.4)
  Seleccionado: animación scale [1, 1.1, 1], box-shadow 0 4px 12px rgba(245,158,11,0.4)
- BookingPanel: sticky top-20, shadow 0 4px 16px, padding 24px
  Título "Tu reserva" con barra cyan, Montserrat 700 18px
  Empty state: ticket SVG 40px muted, texto Poppins 400 13px
  Con asientos: badge cyan claro, código, precio, botón X (muted hover rojo)
  Separator #f1f5f9, Total Poppins 600 / Montserrat 800 22px cyan
  Labels visibles sobre inputs (Nombre/Email pasajero), focus cyan
  Botón "Cancelar": #f1f5f9 hover #e2e8f0
  Botón "Confirmar reserva": cyan hover blue, disabled opacidad 0.4
  Spinner en loading
