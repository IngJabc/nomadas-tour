# Frontend — Sistema de Reservas de Viajes (Web)

Interfaz web para pasajeros, agencias y superadmin de la plataforma de reserva de boletos. Consume la API del backend (ver `backend-AGENT.md`).

## Stack

- Lenguaje: TypeScript estricto
- Framework / runtime: Next.js (App Router)
- Estilos: Tailwind CSS, siguiendo el design system en `DESIGN_TOKENS.md` (colores, tipografía y componentes ya definidos — no hardcodear valores)
- Tests: Vitest / Testing Library (ajustar al que ya uses)

## Comandos

- `npm run dev` — arranca el servidor en local
- `npm run test` — ejecuta los tests (deben pasar antes de cada commit)
- `npm run lint` — revisa el estilo (antes de cada PR)
- `npm run build` — compila para producción

## Estructura del proyecto

- `app/(public)/` — `/login`, `/register`, `/`, `/trips/[id]`, `/dashboard` (pasajero)
- `app/(admin)/admin/` — panel con sidebar navy, exclusivo de `superadmin`
- `app/(admin)/admin/agencies/` — vista nueva: overview de agencias
- `app/(admin)/admin/routes/` — CRUD de rutas
- `app/(admin)/admin/trips/` — CRUD de viajes (incluye asignación de agencias + cupos)
- `components/` — componentes compartidos (Button, Input, Card, Badge, Modal, SeatMap)
- `lib/api/` — clientes tipados hacia el backend
- `lib/auth/` — helpers de sesión y guard de rutas por rol

## Cambios de producto a implementar

1. **Rol Superadmin**: nuevo nivel por encima de `admin`. En la UI, el rol `admin` se muestra siempre como **"Agencia"** (el valor interno sigue siendo `admin`, ver backend).
2. **Reasignación de permisos**: las pantallas de CRUD de rutas y viajes, y de creación de agencias, se mueven a rutas exclusivas de `superadmin`. El rol Agencia deja de tener acceso a esos CRUD.
3. **Creación de viaje con multi-agencia**:
   - Select buscador (async, tipo combobox) para elegir una o más agencias por viaje.
   - Por cada agencia seleccionada, un campo numérico de "cupos asignados".
   - Validación en el formulario: suma de cupos asignados ≤ cupos totales del viaje, con feedback visual inmediato (no solo al enviar).
4. **Registro de agencias por invitación**:
   - Pantalla/acción en `admin/agencies` para "Generar invitación": produce un link único y su QR (usar `qrcode.react` o similar), con botón de copiar y compartir.
   - Nueva ruta pública `/register-agency?token=...` que valida el token contra el backend antes de mostrar el formulario de registro. Si el token es inválido/expirado, mostrar estado de error claro, no un formulario roto.
5. **Overview de agencias (nuevo ítem de sidebar para superadmin)**:
   - Grid de cards, una por agencia, con sus datos (nombre, contacto, fecha de alta).
   - Dentro de cada card, los viajes asignados como **badges** clickeables que navegan a `/trips/[id]` (página ya existente).
   - Cada agencia solo debe reflejar aquí su propio cupo, nunca el de otras agencias (esto lo filtra el backend, pero el componente no debe intentar mostrar datos que no vengan en la respuesta).
6. **Rediseño del dashboard de superadmin**: premium, profesional, con elementos 3D, manteniendo estrictamente los tokens de `DESIGN_TOKENS.md` (cyan `#00D4FF`, navy `#000024`, Montserrat/Poppins). Sugerido: profundidad con capas de sombra + `translateY` en hover (ya definido para cards), acentos con gradientes sutiles cyan→azul solo en elementos de foco (KPIs, CTA), y algún elemento 3D ligero (ej. Three.js para un ícono/hero decorativo, no para datos). Evitar el "dashboard genérico" — usar la skill de diseño de frontend si está disponible en el agente.

## Convenciones

- camelCase para variables/funciones, PascalCase para componentes.
- Tests al lado del archivo: `Foo.tsx` + `Foo.test.tsx`.
- Todo botón que dispara una acción asíncrona tiene 3 estados: normal, loading (spinner + disabled), resultado (éxito/error) — regla ya definida en `DESIGN_TOKENS.md`, no repetir aquí, solo respetarla.
- Formularios validados con Zod + react-hook-form (o el que ya uses) antes de llamar a la API.
- Toda pantalla nueva de superadmin usa el layout con sidebar, nunca el layout público.

## No hagas

- No dar acceso a las pantallas de CRUD de rutas/viajes/agencias a un usuario con rol Agencia.
- No mostrar cupos de otras agencias en ningún componente, aunque el dato llegara por error del backend — filtrar/ocultar defensivamente.
- No crear una pantalla de registro de agencia accesible sin token válido.
- No aproximar los colores/fuentes de marca — usar siempre las variables de `DESIGN_TOKENS.md`.
- No instalar dependencias nuevas (ej. librería de QR o 3D) sin avisar primero.
- No tocar la página `/trips/[id]` existente más allá de lo necesario para que los badges naveguen ahí.

## Flujo de trabajo

- Antes de una tarea no trivial, propón un plan y espera mi OK.
- Una tarea a la vez; al terminar, dime qué cambiaste para que lo revise.
- Si no estás seguro al 80%, pregunta. No inventes endpoints del backend — confirma contra `backend-AGENT.md` o pregunta.

## Documentación

- Design system / reglas de UI: `DESIGN_TOKENS.md` (adjunto al proyecto)
- Contrato de API y modelo de datos: `backend-AGENT.md`
- Logos SVG oficiales: `/public/brand/`
