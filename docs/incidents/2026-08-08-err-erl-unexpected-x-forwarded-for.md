# Incidente: `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` (API)

| Campo | Valor |
|-------|--------|
| **Fecha** | 2026-08-08 |
| **Severidad** | Media (errores en autenticación / rate limit; API reiniciada tras redeploy) |
| **Servicio afectado** | API backend (Web Service en Render) |
| **Servicio no causal** | Worker (outbox / email) |
| **Estado** | Resuelto en producción |

---

## 1. Contexto

El incidente se observó el **08/08/2026** tras un **redeploy manual** del último commit en Render. El redeploy se realizó para verificar en tiempo real el worker, después de ajustar su Build Command / Start Command.

**Hecho confirmado:** el worker quedó operativo (`outbox_relay_started`, heartbeats). El error en logs correspondía a la **API** y es **independiente del worker**.

### Despliegue de la API en Render

| Campo | Valor |
|-------|--------|
| **Root Directory** | `backend` |
| **Build Command** | `npm install; npm run build` |
| **Start Command** | `npm run start` |
| **Script `start`** | `node dist/index.js` |

---

## 2. Síntoma

Tras el restart/redeploy de la API aparecieron errores con este mensaje:

```text
ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false (default).
```

Código:

```text
ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
```

El stack trace apuntaba a **`express-rate-limit`**.

### Lo que **no** causó el incidente (hechos de historial git / dependencias)

| Afirmación | Evidencia / estado |
|------------|--------------------|
| No hubo bump de `express-rate-limit` el día del incidente | `express-rate-limit@8.5.2` presente desde **12/07/2026**; no se actualizó el 08/08 |
| El rate limiting de auth tampoco “nació” el 08/08 | Existía desde **12/07/2026**; `strictLimiter` / `meLimiter` se reestructuraron el **01/08/2026** |
| El worker no introdujo este error | Problema de Express + proxy + rate-limit en la API |

La validación de `express-rate-limit` se ejecuta al **recibir requests**. Una instancia recién iniciada volvió a ejecutar esa validación ante tráfico de producción, haciendo el problema **visible** tras el redeploy.

---

## 3. Investigación y causa raíz

Investigación (código + comportamiento de Express / `express-rate-limit` / proxy-addr) confirmó:

1. `backend/src/app.ts` **no** tenía configuración explícita de `trust proxy`.
2. Express usaba el default: **`trust proxy = false`**.
3. Render coloca un **proxy / load balancer** delante del proceso Node.
4. Las requests de producción llegan con el header **`X-Forwarded-For`**.
5. `express-rate-limit@8.5.2` detecta la combinación inconsistente:
   - `X-Forwarded-For` presente
   - `trust proxy === false`  
   y lanza `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
6. Los rate limiters de auth usan el **`keyGenerator` por defecto** (basado en `req.ip`); no había `keyGenerator` custom.
7. Con `trust proxy=false`, **`req.ip` no representa correctamente** al cliente detrás del proxy.
8. **Inferencia operativa:** eso podía agrupar rate limits por la IP del proxy y degradar el comportamiento del límite de autenticación (además del error duro de validación).

**Aclaración explícita:** el worker **NO** fue la causa del incidente.

---

## 4. Por qué apareció el 08/08 si el código ya existía

Hay que separar dos momentos:

| Momento | Qué ocurrió |
|---------|-------------|
| **Introducción del código problemático** | Dependencia `express-rate-limit@8.5.2` + limiters de auth sin `trust proxy` ya estaban en el código antes del 08/08 |
| **Visibilidad en producción** | Redeploy/restart de Render levantó una instancia limpia; ante requests reales con `X-Forwarded-For`, la validación de `express-rate-limit` falló de nuevo |

**No se afirma** (por falta de evidencia) que Render hubiera cambiado su topología de proxy el 08/08, ni que hubiera habido un cambio no demostrado en la dependencia ese día. Lo confirmado es: restart → instancia nueva → validación ante tráfico con `X-Forwarded-For`.

---

## 5. Solución implementada

En `backend/src/app.ts`, inmediatamente después de:

```ts
const app = express();
```

se añadió:

```ts
app.set('trust proxy', 1);
```

### Por qué `1` (para este servicio / despliegue)

| Opción | Decisión |
|--------|----------|
| `1` | **Elegida.** Render tiene al menos un LB delante del proceso; se confía solo en ese hop inmediato |
| `true` | **Rechazada.** Demasiado permisivo; puede permitir spoofing de `X-Forwarded-For` |
| `2` | **No elegida** sin evidencia de un segundo proxy/CDN delante de Render |

`trust proxy = 1` se documenta aquí como la configuración **validada para esta API en este despliegue Render**, no como una verdad universal para cualquier servicio en Render. Subir a `2` queda **condicionado a evidencia real** de topología (p. ej. Cloudflare u otro hop adicional).

**Fuera de alcance de la solución (y del incidente):** cleanup opcional en `auth.controller.ts` (`req.ip \|\| req.headers['x-forwarded-for']`). No forma parte necesaria del fix.

---

## 6. Test de regresión

Archivo:

```text
backend/src/app.test.ts
```

Cobertura:

1. `app.get('trust proxy') === 1` (protege regresiones a `false` / `true`).
2. Request con `X-Forwarded-For` a `POST /api/auth/validate-invitation` **no** produce `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
3. La request llega al flujo normal de validación y responde **`400`** con `error.code === 'VALIDATION_ERROR'`.

Stack del test: Vitest, `app.listen(0)`, `fetch`. Sin dependencias nuevas (sin supertest).

---

## 7. Validación local

```text
Test Files  30 passed (30)
Tests       214 passed (214)
```

```text
npm run build
exit 0
```

```text
git diff --check
```

sin errores.

---

## 8. Validación en producción (API)

Tras el deploy con el fix, Render mostró:

```text
> npm run start
> node dist/index.js
[Nomadas Tour Backend] Running on port 10000 (production)
==> Your service is live 🎉
```

y **no** volvió a aparecer:

```text
ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
```

Después se creó una **reserva real de prueba**.

**Hecho / límite de observabilidad:** la API no tiene logging detallado de cada operación; durante la creación de la reserva los logs de la API solo mostraron información de infraestructura/servicio de Render y **no** mostraron errores. La evidencia funcional adicional del flujo asíncrono vino del **worker**.

---

## 9. Validación end-to-end (worker / outbox)

Logs reales del worker tras la reserva de prueba:

- `outbox_claimed` para `reservation.created`
- `outbox_processing_started`
- Primer intento con `attempts: 1`
- `outbox_requeued` con `reason: "flags_not_settled"`
- Segundo procesamiento con `attempts: 2`
- `outbox_completed` con:
  - `status: "completed"`
  - `reason: "sent"`

Heartbeat posterior:

```text
events_processed_total: 1
events_failed_total: 0
events_retried_total: 1
events_skipped_total: 0
current_processing_count: 0
last_processing_duration_ms: 3255
last_success_at: "2026-08-08T04:48:11.540Z"
last_error_at: null
```

**Interpretación:** el `outbox_requeued` **no** fue un fallo definitivo; el evento se reintentó y luego se completó correctamente (`sent`).

---

## 10. Conclusión

- **Causa raíz confirmada:** ausencia de `trust proxy` en Express detrás del proxy de Render, incompatible con `X-Forwarded-For` + `express-rate-limit@8.5.2`.
- **No** causado por el worker.
- **No** causado por una actualización de `express-rate-limit` el día del incidente.
- **Solución:** `app.set('trust proxy', 1)` en `backend/src/app.ts`.
- Fix validado localmente (tests + build + `git diff --check`).
- Deploy de producción limpio respecto a `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
- Reserva real de prueba + worker confirmaron API + outbox + worker end-to-end; el worker procesó `reservation.created` hasta `completed` / `sent`.

---

## 11. Seguimiento

- Mantener **`trust proxy = 1`**.
- No subir a **`2`** sin evidencia de un proxy/CDN adicional.
- Nunca usar **`trust proxy = true`** para este caso.
- Si en el futuro se coloca Cloudflare/CDN delante de Render, **revisar topología y hop count** antes de cambiar el valor.
- No usar como workaround: `keyGenerator` custom ad hoc ni desactivar la validación de `express-rate-limit`.
- Cleanup opcional de IP en `auth.controller.ts`: **fuera de este incidente**; no es parte necesaria de la solución.
