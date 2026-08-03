# Backend deploy

El backend corre JavaScript compilado desde `backend/dist/`, generado a partir de `backend/src/`.  
**`backend/dist/` no está en Git** — cada deploy debe compilar antes de arrancar.

---

## Render (producción)

En Render el build y el start son pasos separados. **No usar `prestart`** ni depender de que `npm start` compile.

| Campo | Valor |
|-------|--------|
| **Root Directory** | `backend` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |

Equivalente:

- **Build:** `tsc` → genera `dist/` en el servidor de build
- **Start:** `node dist/index.js` → solo ejecuta lo ya compilado

Render conserva el artefacto del build entre build y start en el mismo deploy. Si el build falla, el servicio no arranca con un `dist/` obsoleto o inexistente.

### Verificación post-deploy

1. Revisar logs del **build** — debe terminar con `tsc` sin errores.
2. Revisar logs del **start** — el servidor debe escuchar sin `Cannot find module` ni rutas a `dist/` vacío.
3. Confirmar variables de entorno (sección [Environment](#environment)).

---

## Desarrollo local

```bash
cd backend
npm install
npm run dev
```

`npm run dev` usa `tsx watch src/index.ts`. No requiere compilar manualmente.

---

## Probar build de producción en local

```bash
cd backend
npm install
npm run build
npm start
```

Útil antes de pushear cambios que afecten TypeScript o imports ESM.

---

## Artefactos

- **`backend/dist/`** está en `.gitignore` y **no debe commitearse**.
- La fuente de verdad es **`backend/src/`**.
- Nunca desplegar un `dist/` trackeado en Git ni asumir que existe en el clone.

---

## Environment

Configurar variables en Render (Environment) o en `backend/.env` en local.  
Las variables requeridas se validan al arrancar en `backend/src/config/env.ts`.

---

## Resumen de scripts (`backend/package.json`)

| Script | Uso |
|--------|-----|
| `npm run dev` | Desarrollo con hot reload |
| `npm run build` | Compila `src/` → `dist/` (`tsc`) |
| `npm start` | Ejecuta `node dist/index.js` (requiere build previo) |
| `npm test` | Tests unitarios |

**Importante:** `npm start` **no** ejecuta `build`. En Render eso ocurre en **Build Command**. En local, correr `npm run build` antes de `npm start` si `dist/` no existe o está desactualizado.
