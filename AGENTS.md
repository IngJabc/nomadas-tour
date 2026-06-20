> Este archivo es de lectura obligatoria antes de comenzar cualquier tarea.
> Contiene las reglas del proyecto. No las ignores, no las inventes.

---

## 🎨 Design Tokens — Single Source of Truth

### Colores (usar SIEMPRE estas variables, nunca valores hardcodeados)

```css
--color-brand-cyan:       #00D4FF   /* Acento principal, CTAs, highlights */
--color-brand-blue:       #0080FF   /* Acento secundario, hovers */
--color-brand-navy:       #000024   /* Fondo principal, navbar, sidebar */
--color-brand-dark:       #00000C   /* Fondo más oscuro, hero sections */
--color-brand-mid:        #0a0a2e   /* Fondos intermedios (derivado de marca) */
--color-brand-surface:    #fdfdfd   /* Tarjetas y formularios */
--color-brand-muted:      #6b7280   /* Textos secundarios */
```

### Colores semánticos (no cambiar)

Success: #10b981

Warning: #f59e0b

Danger: #ef4444

Info: #00D4FF (mismo que cyan)

Page bg: #f1f5f9

### Tipografía

- **Headings (h1–h3, títulos de sección):** Montserrat, peso 700–800
- **Body, labels, botones, links:** Poppins, peso 400/600
- **Nunca usar:** Geist, Inter, u otras fuentes no listadas aquí

### Escala tipográfica

Título página: Montserrat 800 / 28px

Título sección: Montserrat 700 / 20–24px

Título tarjeta: Poppins 600 / 17–18px

Body normal: Poppins 400 / 14px

Label/caption: Poppins 400 / 12–13px

Badge/tag: Poppins 600 / 11–12px

---

## 🧩 Componentes — Reglas de estilo

### Botón Primario (CTA principal)

fondo: --color-brand-cyan

hover: --color-brand-blue

texto: blanco, Poppins 600 14–15px

border-radius: 10px

padding: 10px 20px (normal) / 14px 24px (grande)

transición: background 200ms ease

disabled: opacity 0.4, cursor not-allowed

### Botón Secundario

fondo: #f1f5f9

texto: --color-brand-navy, Poppins 600 14px

border-radius: 10px

hover: fondo #e2e8f0

### Botón Destructivo (Eliminar)

fondo: #fef2f2

texto: #ef4444, Poppins 600 12–14px

border-radius: 8–10px

hover: fondo #fee2e2

SIEMPRE requiere modal de confirmación antes de ejecutar la acción

### Inputs / Campos de formulario

border: 1.5px solid #e5e7eb

border-radius: 10px

padding: 12px 16px

font: Poppins 400 14px

focus: border-color --color-brand-cyan

box-shadow 0 0 0 3px rgba(0,212,255,0.15)

SIEMPRE incluir label visible encima del campo (no solo placeholder)

Label style: Poppins 500 12px, --color-brand-muted, uppercase

### Tarjetas (Cards)

fondo: #ffffff

border-radius: 16px

box-shadow: 0 2px 8px rgba(0,0,0,0.07)

hover: box-shadow 0 6px 24px rgba(0,212,255,0.15)

translateY(-2px), transición 200ms

border-left: 4px solid --color-brand-cyan (en tarjetas de contenido)

### Títulos de sección

Siempre con barra izquierda de 4px en --color-brand-cyan

Implementar con border-left o pseudo-elemento ::before

padding-left: 12px

### Badges / Pills de estado

Activo/Disponible: fondo #ecfdf5, texto #059669

Inactivo/Reservado: fondo #f1f5f9, texto --color-brand-muted

Cancelado: fondo #fef2f2, texto #ef4444

Advertencia: fondo #fffbeb, texto #92400e

border-radius: 9999px (siempre pill)

padding: 3px 10px

font: Poppins 600 11px

---

## 🗺️ Estructura de pantallas

### Área pública (usuario)

- `/login` → Login 2 columnas (hero + formulario)
- `/register` → Registro 2 columnas (mismo hero)
- `/` → Lista de viajes disponibles
- `/trips/[id]` → Selección de asientos
- `/dashboard` → Mis reservas

### Área admin

- `/admin` → Panel con sidebar navy izquierdo
- `/admin/trips` → Gestión de viajes
- `/admin/routes` → Gestión de rutas
- El admin SIEMPRE tiene sidebar, nunca navbar horizontal

### Navbar (área pública)

fondo: --color-brand-navy

altura: 64px

sticky: top-0, z-index alto

logo: izquierda

nav links: Poppins 400 14px, blanco opacity 0.75, hover opacity 1

CTA btn: --color-brand-cyan, pill (border-radius 9999px)

---

## 🚌 Mapa de asientos — Estados y colores

Disponible: fondo #00D4FF | texto blanco | cursor pointer

Seleccionado: fondo #f59e0b | texto blanco | scale sutil al click

Reservado: fondo #374151 | texto #6b7280 | cursor not-allowed

Bloqueado: fondo #7c3aed | opacity 0.7 | cursor not-allowed

Guía: fondo #00000C | border 2px solid #00D4FF

### Layout del bus

- **Distribución:** 2 asientos izquierda + pasillo central (32px, vacío) + 2 asientos derecha por fila
- **Orden:** A1 esquina superior izquierda, izquierda→derecha, arriba→abajo
  - Fila 1: [A1][A2] |pasillo| [A3][A4]
  - Fila 2: [A5][A6] |pasillo| [A7][A8]
  - Fila 3: [A9][A10] |pasillo| [A11][A12] ...
- **Pasillo:** div completamente vacío (width 32px, flex-shrink 0), sin íconos ni SVGs
- **Asiento del guía:** renderizado FUERA de la grilla, entre FRENTE y el cuerpo del bus
- Si la cantidad de asientos no es múltiplo de 4, la última fila muestra los restantes en el mismo orden

La leyenda SIEMPRE va encima del mapa, nunca debajo.
El mapa SIEMPRE tiene etiquetas "FRENTE" (arriba) y "FONDO" (abajo).
A1 es el frente del bus (parte superior del mapa).

---

## ⛔ Reglas que NUNCA se rompen

1. Nunca hardcodear colores — usar siempre las variables CSS
2. Nunca usar solo placeholder como label de un campo
3. Nunca mostrar botón "Eliminar" sin modal de confirmación
4. Nunca mostrar el alert "Necesitas iniciar sesión" si el usuario ya está autenticado
5. Nunca usar fuentes distintas a Poppins y Montserrat
6. Nunca crear una pantalla completamente blanca sin contexto de marca
7. Nunca dejar un empty state sin CTA que lleve al siguiente paso
8. El panel admin SIEMPRE tiene sidebar, nunca comparte layout con el área pública
9. Los colores oficiales de la marca son #00D4FF (cyan), #0080FF (azul), 
   #000024 (navy), #00000C (negro). Nunca aproximar con otros valores.
10. Los logos SVG oficiales están en /public/brand/. 
    Nunca crear logos con texto o formas improvisadas.
    Usar siempre los archivos SVG reales.
11. Nunca limpiar el estado de una selección del usuario hasta que 
    haya una confirmación visual explícita de éxito o el usuario 
    navegue voluntariamente fuera de la pantalla.
12. Todo botón que dispara una acción asíncrona (POST, PUT, DELETE) 
    debe tener 3 estados visuales: normal, loading (spinner + disabled), 
    y resultado (éxito o error).
13. El boleto siempre muestra TODOS los asientos de una compra,
    nunca solo el primero del array.
14. El campo "Salida" en el boleto usa departure_time del viaje,
    nunca created_at ni updated_at de la reserva.

---

## ✅ Protocolo de trabajo del agente

Antes de comenzar cualquier tarea:

1. Leer este archivo completo
2. Identificar qué pantalla/componente se va a modificar
3. Planear los pasos en texto antes de escribir código
4. Verificar que los colores y fuentes a usar están en este archivo

Durante la tarea: 5. Usar solo las variables y valores definidos aquí 6. Si algo no está definido aquí, usar el criterio más cercano que sí esté 7. Si hay ambigüedad real, hacer UNA sola pregunta antes de continuar

Al terminar: 8. Correr el servidor y revisar la consola de errores 9. Si hay errores, corregirlos sin preguntar 10. Verificar contra el checklist de la tarea (ver TASKS.md) 11. Solo reportar "listo" cuando el servidor corra sin errores
