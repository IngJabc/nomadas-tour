# Nómadas Tour — Plan de Remediación y Pasos de Validación

**Documento:** Entrega de auditoría de seguridad — Sección de remediación
**Alcance:** Hallazgos Críticos C1–C4 (verificados contra el código actual)
**Audiencia:** Cliente técnico (Supabase/Postgres + Next.js + Express)
**Estado de verificación previo:** C1 VERIFIED · C2 PARTIALLY VERIFIED · C3 VERIFIED · C4 PARTIALLY VERIFIED  
**Estado de remediación (2026-08-01):** C1–C4 remediados en prod pre-lanzamiento. Validación manual checklist §5.1 completada (forja metadata, cuenta agency).

> Este documento describe remediación y validación. **Los fixes C1–C4 están aplicados** (migraciones 035–040, FASE 4 frontend). Pendiente: automatizar checklist en `tests/security/` (SEC-007).

---

## 0. Resumen ejecutivo y matriz de prioridades

| # | Hallazgo | Veredicto | Prioridad | Explotable hoy | Depende de estado de la DB |
|---|---|---|---|---|---|
| C1 | Identidad forjable vía `user_metadata` | ✅ VERIFIED | **P0** | Sí | No |
| C3 | `create_agency_reservation` SECURITY DEFINER público | ✅ VERIFIED | **P0** | Sí | No |
| C2 | `password_resets` sin RLS | ⚠️ PARTIAL | **P1 → P0 si se confirma grant** | Condicional | Sí |
| C4 | `seats_auth_update` demasiado permisiva | ⚠️ PARTIAL | **P1 → P0 si se confirma grant** | Condicional | Sí |

**Causa raíz compartida (C1, C2, C4):** la autorización en las 3 capas (Next.js middleware, Express, RLS) confía en claims client-writable o en roles amplios sin scoping. El remedio estructural es único: **`public.users` como única fuente de verdad de rol/agencia + default-deny para escrituras de cliente**.

**Hecho clave que simplifica la migración:** el login ya resuelve la identidad desde `public.users` (`backend/src/services/auth.service.ts:23-38`). El modelo seguro ya existe; el defecto es que las capas posteriores lo ignoran y releen `user_metadata`.

---

## 1. C1 — Identidad forjable vía `user_metadata` → P0

### 1.1 Remediación recomendada (defensa en profundidad, 4 capas)

La corrección se aplica en **todas** las capas que hoy confían en `user_metadata`. La capa 1 es el bloqueo inmediato del vector crítico (API con service-role); las capas 2–4 eliminan la confianza residual.

### 1.2 Plan de migración a un modelo seguro

#### Fase 0 — Backfill y consistencia (antes de cualquier corte)

Asegurar que **todo** `auth.users` tenga fila en `public.users`, para que el cambio no rompa logins legítimos.

```sql
-- 035_backfill_users_from_auth.sql (idempotente, se puede re-ejecutar)
INSERT INTO public.users (id, email, role, agency_id)
SELECT au.id,
       au.email,
       COALESCE(NULLIF(au.raw_user_meta_data->>'role',''), 'user'),
       NULLIF(au.raw_user_meta_data->>'agency_id','')::uuid
FROM auth.users au
ON CONFLICT (id) DO NOTHING;

-- Auditoría de brechas (debe devolver 0 filas antes de cortar):
SELECT au.id, au.email
FROM auth.users au
LEFT JOIN public.users u ON u.id = au.id
WHERE u.id IS NULL;
```

> Nota: las invitaciones de agencia ya escriben en `public.users` (`auth.service.ts:210-215`). La brecha histórica son cuentas creadas fuera de ese flujo (p. ej. superadmin inicial). El backfill las cierra.

#### Fase 1 — Endurecer Express (bloqueo inmediato del vector API)

`backend/src/middlewares/auth.ts` debe construir `req.ctx` desde `public.users`, jamás desde `user_metadata`.

```ts
// backend/src/middlewares/auth.ts — reemplazo de extractContext/auth
import { supabase, supabaseAdmin } from '../config/database.js';

async function extractContext(user: { id: string }) {
  const { data: dbUser } = await supabaseAdmin
    .from('users')
    .select('id, role, agency_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!dbUser) {
    throw new UnauthorizedError('Usuario no registrado');
  }

  return {
    userId: dbUser.id,
    role: dbUser.role as RequestContext['role'],
    agencyId: dbUser.agency_id ?? null,
  };
}

export async function auth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Falta o es inválido el encabezado de autorización');
  }

  const token = header.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new UnauthorizedError('Token inválido o expirado');
  }

  req.ctx = await extractContext(user);
  next();
}
```

Cambios asociados en el mismo frente:

- **`backend/src/services/auth.service.ts:33-38`** — eliminar la rama de fabricación de identidad superadmin. Si no hay fila en `public.users`, lanzar `UnauthorizedError('Usuario no encontrado')` (como la rama de línea 40). Solo eliminar después de Fase 0.
- **`backend/src/middlewares/tenant.ts:8-18`** — además de validar que la agencia existe y está activa, verificar membresía: `req.ctx.agencyId` debe coincidir con el `agency_id` del usuario en `public.users`. Si `req.ctx.role === 'superadmin'` se permite `agencyId = null` (operación global).
- **`backend/src/middlewares/authorize.ts:10-12`** — sin cambios de lógica; ya valida contra `req.ctx.role`, que ahora proviene de la DB.

#### Fase 2 — Reescribir RLS para usar `public.users` (no `user_metadata`)

Patrón recomendado (sin crear más funciones SECURITY DEFINER): EXISTS sobre `public.users` con `auth.uid()`. `auth.uid()` no es forjable (el `sub` del JWT es emitido por Supabase Auth).

```sql
-- 036_rls_identity_from_public_users.sql
-- Reemplaza todas las políticas que leen auth.jwt() -> 'user_metadata' ->> 'role'/'agency_id'
-- de 019, 011, 029, 032 y 027.

-- Ejemplo superadmin (aplicar a agencies, routes, trips, seats, trip_agencies,
-- reservations, reservation_passengers, boarding_logs, notifications, users):
DROP POLICY IF EXISTS "agencies_superadmin_all" ON agencies;
CREATE POLICY "agencies_superadmin_all" ON agencies
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- Ejemplo agencia con scope (aplicar a users, reservations, rp, bl, notifications, prefs):
DROP POLICY IF EXISTS "reservations_agency_read" ON reservations;
CREATE POLICY "reservations_agency_read" ON reservations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'agency'
        AND u.agency_id = reservations.agency_id
    )
  );

DROP POLICY IF EXISTS "reservations_agency_insert" ON reservations;
DROP POLICY IF EXISTS "bl_agency_insert" ON boarding_logs;
-- Las inserciones de cliente se ELIMINAN: toda escritura pasa por Express (service-role).
```

Reglas del rewrite (aplicar a TODAS las políticas de 019/011/029/032/027):

1. `auth.jwt() -> 'user_metadata' ->> 'role'` → `EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = '...')`
2. `auth.jwt() -> 'user_metadata' ->> 'agency_id'` → comparar contra `u.agency_id` del mismo EXISTS.
3. Eliminar políticas `*_insert` de cliente (`reservations_agency_insert`, `bl_agency_insert`) — escrituras solo por service-role.
4. Las políticas de lectura pública (`*_public_read`) se conservan tal cual.

**Alternativa (solo si se quiere acceso RLS desde cliente sin reescribir 20 políticas):** Custom Access Token Hook. Ver Fase 3.

#### Fase 3 — Custom Access Token Hook (opcional, defensa en profundidad)

Si se decide conservar acceso RLS vía JWT, se puede emitir un claim no forjable en el token:

```sql
-- Se configura en Dashboard → Authentication → Hooks → Custom Access Token
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
  declare
    claims jsonb;
    u public.users%rowtype;
  begin
    select * into u from public.users where id = (event->>'user_id')::uuid;
    if u.id is not null then
      claims := event->'claims';
      claims := jsonb_set(claims, '{app_role}', to_jsonb(u.role));
      claims := jsonb_set(claims, '{app_agency_id}', to_jsonb(u.agency_id));
      event := jsonb_set(event, '{claims}', claims);
    end if;
    return event;
  end;
$$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
```

Las políticas pasarían a `auth.jwt() ->> 'app_role'` (claim firmado, no client-writable). **Importante:** el hook NO sustituye a la Fase 1 — Express debe seguir leyendo `public.users` porque `getUser()` devuelve `user_metadata`/`app_metadata` de la DB, no los claims del hook (el hook solo modifica la JWT).

#### Fase 4 — Endurecer middleware Next.js y limpieza

- **`middleware.ts:54-83`** — sustituir `user?.user_metadata?.role` por una consulta a `public.users` usando un server client con service-role (mismo patrón de `supabaseAdmin`), o por la lectura del claim `app_role` del token si se implementó la Fase 3. El middleware es UX (no es frontera de seguridad real — la API la protege Express), pero no debe sugerir protección falsa.
- **Limpiar claims obsoletos** (opcional, al final): `updateUser({ data: { role: undefined, agency_id: undefined } })` en el login para que `user_metadata` quede solo para UI. Requiere reintroducir datos de display en otro claim si se necesitan.
- **`hooks/useRealtimeSeats.ts:67-88`** — ver C4 (se elimina la escritura cliente).

#### Rollback

El modelo es reversible por fases:

1. Si Fase 1 rompe logins → volver a `extractContext` basado en metadata (un solo archivo) hasta depurar el backfill.
2. Si Fase 2 rompe realtime → las políticas viejas de 019 siguen en la DB; re-aplicar el archivo 019 original.
3. Mantener `user_metadata` poblado durante toda la migración (no limpiarlo hasta el final) para permitir el revert simétrico.

### 1.3 Archivos afectados

| Archivo | Cambio |
|---|---|
| `backend/src/middlewares/auth.ts` | `extractContext` desde `public.users` vía service-role |
| `backend/src/middlewares/tenant.ts` | Verificación de membresía usuario↔agencia |
| `backend/src/middlewares/authorize.ts` | Sin cambio lógico |
| `backend/src/services/auth.service.ts:33-38` | Eliminar fabricación de superadmin |
| `middleware.ts:54-83` | Gate de `/admin` y `/agency` desde DB/claim |
| `supabase/migrations/019_fix_rls_policies.sql` | Reescribir políticas (nueva migración) |
| `supabase/migrations/011/029/032/027` | Misma reescritura (migración única que reemplaza) |
| `lib/supabase/server.ts` | Exponer server client service-role si no existe |
| `supabase/migrations/035_backfill_users_from_auth.sql` | Backfill idempotente |

### 1.4 Riesgos de aplicar la corrección

- **Login roto para cuentas sin fila en `public.users`** → mitigado por Fase 0 (backfill previo + auditoría de brechas = 0 filas).
- **Superadmin inicial sin fila en DB** → el backfill de Fase 0 lo cubre; el corte de la rama de fabricación (Fase 1) debe ir DESPUÉS de validar el backfill.
- **RLS nueva puede romper realtime** si una política de agencia queda con `EXISTS` mal escrito (p. ej. comparar `u.agency_id` contra la tabla equivocada). Mitigación: aplicar la migración RLS en entorno de staging y validar el checklist (sección 5) antes de producción.
- **Latencia de un query extra por request** en Express → despreciable (índice primario en `users.id`); opcional: cachear en memoria por 60s con invalidación por logout.

### 1.5 Cómo validar que quedó corregido

- Ejecutar la prueba 1 y 2 del checklist (sección 5): forjar `role` y obtener 403 en todas las APIs superadmin; JWT manipulado → 401.
- Verificar que `req.ctx.role` proviene de DB: cambiar `role` en `public.users` (vía SQL Editor) y confirmar que los permisos cambian sin re-emitir token.
- Regresión completa de login (superadmin, agencia, usuario), invitación y reset.

---

## 2. C3 — `create_agency_reservation` SECURITY DEFINER público → P0

### 2.1 Estrategia segura para funciones SECURITY DEFINER

La función se invoca **exclusivamente** desde el backend (`backend/src/services/reservation.service.ts:193` con `supabaseAdmin.rpc`, role `service_role`). Por tanto, la exposición a `anon`/`authenticated` vía PostgREST debe revocarse.

```sql
-- 037_revoke_rpc_public_execute.sql
-- 1) Revocar ejecución a todos los roles excepto service_role.
REVOKE EXECUTE ON FUNCTION public.create_agency_reservation(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT[], TEXT[], TEXT[]
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_agency_reservation(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT[], TEXT[], TEXT[]
) TO service_role;

-- 2) Inertifiar create_superadmin (placeholder vacío, SECURITY DEFINER + PUBLIC execute).
REVOKE EXECUTE ON FUNCTION public.create_superadmin(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
-- o eliminar directamente:
DROP FUNCTION IF EXISTS public.create_superadmin(TEXT, TEXT, TEXT);
```

### 2.2 Validación de `auth.uid()` y tenant dentro de la función

Con la revocación, la función solo corre bajo `service_role`, y la autorización ya la hace Express. Aun así, defensa en profundidad: la función debe validar que el creador es un usuario de agencia de esa agencia (rechaza `p_created_by`/`p_agency_id` arbitrarios en caso de un futuro refactor o llamada interna errónea).

```sql
-- Modificación dentro de create_agency_reservation (PL/pgSQL)
DECLARE
  ...
  v_creator_is_valid BOOLEAN;
BEGIN
  -- 0. Validar que el creador existe, es agencia y pertenece a p_agency_id
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_created_by AND role = 'agency' AND agency_id = p_agency_id
  ) INTO v_creator_is_valid;

  IF NOT v_creator_is_valid THEN
    RAISE EXCEPTION 'ERR_CREATOR_INVALID: Creator is not a valid agency user';
  END IF;

  -- (se mantienen las validaciones existentes: viaje activo, agencia asignada,
  --  coincidencia de arrays y bloqueo FOR UPDATE de asientos, líneas 34-77)
```

> Nota: NO usar `SECURITY INVOKER` como "fix" sin más — las tablas están con RLS y el rol invocador no tiene permisos de INSERT; rompería el flujo. La estrategia correcta es: **seguir SECURITY DEFINER, ejecución restringida a service_role, y validación de identidad/tenant dentro del cuerpo**.

### 2.3 Auditoría de funciones similares vulnerables

Inventario actual del repositorio (grep `SECURITY DEFINER` sobre `supabase/migrations/`):

| Función | Ubicación | Estado |
|---|---|---|
| `create_agency_reservation` | `014_agency_reservation_function.sql:22` | **Vulnerable** — corregir |
| `create_superadmin` | `006_multi_tenant_schema.sql:196-208` | Placeholder inerte (retorna NULL) — revocar/eliminar |

Consultas para auditar la DB viva (puede haber funciones fuera de los archivos):

```sql
-- Todas las funciones SECURITY DEFINER en schema public:
SELECT p.oid::regprocedure AS funcion,
       p.prosecdef AS security_definer,
       p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef;

-- Funciones con EXECUTE otorgado a PUBLIC (o sin proacl = execute público por defecto):
SELECT routine_name, routine_schema
FROM information_schema.routine_privileges
WHERE grantee = 'PUBLIC' AND routine_schema = 'public';
```

Criterio: **toda** función `SECURITY DEFINER` ejecutable por `PUBLIC`/`anon`/`authenticated` debe tratarse como hallazgo hasta ser auditada. La política a futuro: funciones definidas por `postgres` no deben quedar con `EXECUTE` público; agregar `REVOKE`/`GRANT` explícito en cada migración que cree funciones.

### 2.4 Archivos afectados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/014_agency_reservation_function.sql` | Nueva migración 037 con REVOKE/GRANT + validación en el cuerpo |
| `supabase/migrations/006_multi_tenant_schema.sql` | `create_superadmin`: revocar/drop |
| `backend/src/services/reservation.service.ts:193` | Sin cambio (service-role) |

### 2.5 Riesgos de aplicar la corrección

- **Romper la creación de reservas de agencia** si el backend no usa `service_role` para la RPC. Verificado: sí usa `supabaseAdmin.rpc` → sin riesgo.
- **El `GRANT TO service_role` debe acompañar al `REVOKE`** en la misma transacción/migración, o las reservas de agencia fallarán hasta que el DBA lo agregue a mano.
- Validación nueva `ERR_CREATOR_INVALID`: si alguna agencia crea reservas con un `p_created_by` que no cumple `role='agency' AND agency_id=p_agency_id` (p. ej. reservas creadas por el superadmin en nombre de una agencia), fallará. Verificar el flujo de reservas de agencia en staging antes de producción.

### 2.6 Cómo validar que quedó corregido

- Prueba 3 del checklist: invocar la RPC con anon key → debe devolver **404/403** (función no expuesta por PostgREST).
- Crear una reserva desde el panel de agencia → debe funcionar (service-role OK).
- Prueba 6 del checklist: listar funciones SECURITY DEFINER → ninguna ejecutable por PUBLIC/anon/authenticated.

---

## 3. C2 — `password_resets` sin RLS → P1

### 3.1 Vulnerabilidad confirmada

- `024_password_resets.sql` crea la tabla **sin** `ENABLE ROW LEVEL SECURITY`, sin políticas y sin revocaciones. `025` solo agrega `failed_attempts`.
- Contiene secretos: `token` (link directo de reset) y `code_hash` (SHA-256 del código de 6 dígitos, brute-force offline trivial de 1/1M).
- Con RLS deshabilitada, **cualquier rol con privilegio sobre la tabla** tendría acceso total: robo de tokens → cambio de contraseña de la víctima (account takeover); también marcar usados (DoS) o inyectar registros propios.
- El backend accede solo vía `supabaseAdmin` (`auth.service.ts:72,82,88,109,118,142`).

### 3.2 Condición necesaria para explotación

Que los roles de cliente (`authenticated`/`anon`) tengan **cualquier** privilegio (SELECT/INSERT/UPDATE/DELETE) sobre `public.password_resets`. El repositorio **no contiene ningún `GRANT`** (grep repo-wide: 0 coincidencias); los grants pueden existir en la DB viva vía default privileges o grants manuales. Sin grant, la tabla es invisible para PostgREST y el hallazgo queda latente (aun así se corrige por defensa en profundidad).

### 3.3 Prueba adicional requerida (Supabase Dashboard → SQL Editor)

```sql
-- a) ¿Quién tiene privilegios sobre la tabla?
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'password_resets';

-- b) ¿Está RLS habilitada?
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'password_resets';

-- c) Prueba real de explotación como rol cliente:
SET ROLE authenticated;
SELECT id, user_id, token, code_hash FROM password_resets LIMIT 1;
-- ↑ Si devuelve filas → VULNERABLE HOY (escalar a P0).
RESET ROLE;
```

### 3.4 Remediación

```sql
-- 038_enable_rls_password_resets.sql
-- 1) Revocar cualquier privilegio de cliente (redundante pero explícito):
REVOKE ALL PRIVILEGES ON TABLE public.password_resets FROM anon, authenticated;

-- 2) Habilitar RLS (sin políticas → deny-all para roles no propietarios;
--    service_role y postgres siguen operando por BYPASSRLS):
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

-- (Opcional, explícito) FORCE para que ni el dueño la salte:
-- ALTER TABLE public.password_resets FORCE ROW LEVEL SECURITY;
```

Hardening adyacente del mismo flujo (la tabla es la víctima):

- **Bloqueo de fuerza bruta muerto:** `failed_attempts` se lee en `auth.service.ts:131` pero **nunca se incrementa**. Agregar en la rama de código inválido: `UPDATE password_resets SET failed_attempts = failed_attempts + 1 WHERE id = record.id` (con `record` pre-cargado por código), antes del throw de línea 128.
- **Rate limiting dedicado** para `/reset-password` en `backend/src/routes/auth/index.ts`: el limiter compartido (15 req/15min, líneas 5-9) aplica a login+forgot+reset juntos y no tiene `trust proxy` configurado. Crear un `resetLimiter` separado (p. ej. 10 req/10 min por IP) montado solo en `router.post('/reset-password', ...)`.

### 3.5 Riesgos de aplicar la corrección

- Bajo. El backend usa service-role (BYPASSRLS) → las operaciones de `forgotPassword`/`resetPassword` no se ven afectadas.
- `FORCE ROW LEVEL SECURITY` (opcional) puede romper queries de herramientas externas que conecten como `postgres` — evaluar antes de activarlo.

### 3.6 Cómo validar que quedó corregido

- Re-ejecutar la prueba 3.3(a) y 3.3(c): `SET ROLE authenticated; SELECT ...` debe devolver **0 filas / error de permisos**, y `relrowsecurity = true`.
- Flujo E2E: pedir reset (llega email), usar código y token → ambos deben seguir funcionando.
- Prueba 5 y 7 del checklist.

---

## 4. C4 — `seats_auth_update` demasiado permisiva → P1

### 4.1 Vulnerabilidad confirmada

- Estado final de la política (`011_create_all.sql:214-215`): `FOR UPDATE USING (auth.role() = 'authenticated')`, **sin `WITH CHECK`** y sin scoping por usuario/agencia/viaje. Nunca modificada por 012–034.
- `auth.role() = 'authenticated'` habilita a **cualquier usuario con sesión** (cliente, agencia o superadmin indistinto) a hacer UPDATE de **cualquier asiento de cualquier viaje**, a **cualquier estado** (`reserved`, `blocked`, `boarded`) y con `locked_by` arbitrario.
- El guard `.eq('status','available')` que usa la app (`hooks/useRealtimeSeats.ts:81`) es solo código de la app, no se impone en la política.

### 4.2 Condición necesaria para explotación

Que el rol `authenticated` tenga privilegio `UPDATE` sobre `public.seats` en la DB viva. El repositorio no contiene grants; la única ruta de escritura cliente diseñada (`useRealtimeSeats.updateSeatStatus`, `hooks/useRealtimeSeats.ts:67-88`) es **código muerto** (no se usa en ninguna página — grep: 0 usos). Todas las escrituras vivas de asientos pasan por Express con service-role. Sin el grant, la política es inerte; con el grant, es DoS sobre reservas + corrupción del estado de abordaje.

### 4.3 Prueba adicional requerida (Supabase Dashboard → SQL Editor)

```sql
-- a) ¿Tiene el rol authenticated UPDATE sobre seats?
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'seats';

-- b) Prueba real como rol cliente:
SET ROLE authenticated;
UPDATE public.seats
SET status = 'reserved'
WHERE trip_id = '<ID_VIAJE_REAL>'
  AND seat_code = 'A1';
-- ↑ Si afecta 1 fila → VULNERABLE HOY (escalar a P0).
-- Rollback inmediato:
UPDATE public.seats
SET status = 'available', locked_by = NULL, locked_at = NULL
WHERE trip_id = '<ID_VIAJE_REAL>' AND seat_code = 'A1';
RESET ROLE;
```

### 4.4 Remediación

**Opción A (recomendada — la app no necesita escritura cliente):** eliminar el acceso UPDATE de cliente. Todo cambio de asiento se hace vía Express (service-role), y el realtime informa a los clientes.

```sql
-- 039_remove_seats_client_update.sql
DROP POLICY IF EXISTS "seats_auth_update" ON seats;
REVOKE UPDATE ON TABLE public.seats FROM anon, authenticated;

-- Limpieza de la app:
-- - Eliminar updateSeatStatus de hooks/useRealtimeSeats.ts (código muerto).
-- - Cualquier flujo futuro de "bloquear asiento desde el cliente" debe ir por
--   Express (endpoints /seats/lock y /seats/unlock ya existentes en
--   backend/src/routes/agency/index.ts:25-26, o un endpoint público análogo),
--   nunca por supabase.from('seats').update().
```

**Opción B (solo si el producto exige locking cliente en la pantalla pública):** política acotada a la máquina de estados, que impide marcar `reserved`/`boarded`/`blocked` desde el cliente y fija `locked_by` al propio usuario.

```sql
DROP POLICY IF EXISTS "seats_auth_update" ON seats;
CREATE POLICY "seats_auth_update_scoped" ON seats
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (
    (NEW.status = 'available' AND NEW.locked_by IS NULL)
    OR (NEW.status = 'locked'   AND NEW.locked_by = auth.uid())
  );
```

> Limitación honesta de la Opción B: RLS no puede restringir por columna; el usuario podría tocar `seat_code`/`trip_id` en la fila que ya le es visible. No es un fix completo. La **Opción A es la corrección definitiva**; la B es un parche de mitigación transitorio. La política correcta a largo plazo es la de C1/Fase 2 (`EXISTS` sobre `public.users` + `u.role`) y/o default-deny.

### 4.5 Archivos afectados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/011_create_all.sql:214` | Nueva migración 039 (drop policy + revoke) |
| `hooks/useRealtimeSeats.ts:67-88` | Eliminar `updateSeatStatus` (código muerto) |
| `backend/src/routes/agency/index.ts` / reserva pública | Asegurar que todo write de asientos pasa por Express |

### 4.6 Cómo validar que quedó corregido

- Prueba 4 del checklist: `supabase.from('seats').update(...)` desde el cliente → error de permisos.
- Prueba 5/7: `seats` con RLS y sin grants UPDATE para `authenticated`.
- Regresión: lock/unlock de asientos desde el panel de agencia (Express) sigue funcionando y propagando por realtime.

---

## 5. Post-Fix Security Validation Checklist

Ejecutar en este orden, tras aplicar las migraciones y desplegar el backend. Las pruebas 1–4 deben ejecutarse en el entorno de producción pre-corte y post-corte.

### Estado de validación (2026-08-01)

| Prueba | Descripción | Estado |
|--------|-------------|--------|
| 5.1 | Forja `role` desde cliente | ✅ Validada manualmente + automatizada (`tests/security/identity-forgery.*`) |
| 5.2 | JWT manipulado → rechazo | Parcial (backend tests) |
| 5.3 | RPC sin autorización | 037 aplicada; sin re-test manual documentado |
| 5.4 | UPDATE seats desde cliente | 039 aplicada; sin re-test manual documentado |
| 5.5–5.8 | SQL + regresión E2E | Parcial / pendiente SEC-007 |

Detalle de 5.1: ver [`security-hardening-implementation.md`](security-hardening-implementation.md) — sección FASE 4 validación manual.

---

### 5.1 Forjar `role` desde el cliente → NO debe otorgar privilegios

**Estado:** ✅ Validada 2026-08-01 (manual + [`tests/security/`](../tests/security/))

```js
// Consola del browser, con cuenta agency autenticada:
// PUT /auth/v1/user con data: { role: 'superadmin', agency_id: null }
// (equivalente a supabase.auth.updateUser({ data: { role: 'superadmin' } }))
```

Resultado observado tras el fix:

| Check | Esperado | Resultado |
|-------|----------|-----------|
| Metadata forjada aceptada por Supabase | 200 | OK |
| `GET /auth/me` | `"role": "agency"` | OK |
| Navbar | Sin enlace Admin | OK |
| `/admin` | Bloqueado | OK |
| `GET /api/admin/dashboard` | 403 FORBIDDEN | OK |

Checks adicionales del audit original (sin re-validar en esta sesión):

- POST `/rest/v1/rpc/create_agency_reservation` con anon key → 404/403 (037)
- GET `/rest/v1/agencies` → sin filas de otras agencias

### 5.2 JWT manipulado → rechazo

```bash
# Token con firma inválida (firmar un JWT con una clave aleatoria):
curl -i http://localhost:3001/api/admin/dashboard \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.<payload>.firma_invalida"
# → 401 Unauthorized (getUser() de Supabase rechaza la firma)

# Token válido de un usuario 'user' llamado sobre una API de agencia:
# → 403 Forbidden (authorize('agency') falla porque req.ctx.role proviene de public.users)
```

### 5.3 RPC sin autorización → denegación

```bash
curl -i -X POST "https://<PROJECT_REF>.supabase.co/rest/v1/rpc/create_agency_reservation" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"p_trip_id":"<trip>","p_agency_id":"<agency>","p_created_by":"<uuid>",
       "p_booker_name":"x","p_booker_document":"x","p_booker_phone":"",
       "p_seat_ids":["<seat>"],"p_passenger_names":["x"],
       "p_passenger_documents":["x"],"p_passenger_phones":[""]}'
# → Esperado: 404 (función no expuesta) o 403. NUNCA 200.
```

### 5.4 Modificar `seats` desde el cliente → bloqueado

```js
// Consola del browser, sesión autenticada:
const { data, error } = await supabase
  .from('seats')
  .update({ status: 'reserved' })
  .eq('trip_id', '<ID>')
  .eq('seat_code', 'A1');
// → error NO nulo (permission denied / RLS), data nulo.
```

### 5.5 RLS habilitado en tablas sensibles

```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('password_resets','seats','reservations','reservation_passengers',
                  'boarding_logs','notifications','users','agencies','routes',
                  'trips','trip_agencies','agency_notification_preferences');
-- Esperado: relrowsecurity = true en todas. relforcerowsecurity = true en password_resets.
```

### 5.6 Auditar funciones SECURITY DEFINER restantes

```sql
SELECT p.oid::regprocedure AS funcion,
       p.prosecdef AS security_definer,
       p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef;

SELECT routine_name
FROM information_schema.routine_privileges
WHERE grantee = 'PUBLIC' AND routine_schema = 'public';
-- Esperado: 0 funciones SECURITY DEFINER ejecutables por PUBLIC/anon/authenticated.
```

### 5.7 Verificar grants reales de `anon`/`authenticated`

```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
ORDER BY table_name, grantee, privilege_type;
-- Esperado: SOLO SELECT en tablas de lectura pública (agencies, routes, trips,
-- seats, trip_agencies). NINGÚN UPDATE/INSERT/DELETE sobre tablas de escritura.
```

### 5.8 Regresión funcional E2E

| Flujo | Resultado esperado |
|---|---|
| Login superadmin → `/admin` | OK, dashboard con datos |
| Login agencia → `/agency` | OK, scope de su agencia |
| Forjar role y reload | Sigue sin poder acceder a admin ni APIs superadmin | ✅ Validado 2026-08-01 |
| Crear reserva de agencia (Express + RPC) | OK (service-role conserva ejecución) |
| Lock/unlock de asientos (agencia) | OK, propagación realtime |
| Reset de contraseña (código y token) | OK; 5+ intentos fallidos bloquean (lockout activo) |
| Invitación de agencia | OK |
| Realtime (seats, reservations, boarding_logs) | Canales SIN `CHANNEL_ERROR` |

---

## 6. Orden de ejecución recomendado

1. **Fase 0 (C1):** backfill de `public.users` + auditoría de brechas = 0.
2. **C1 Fase 1 + C3:** cortes de backend (auth.ts DB-backed, eliminar fabricación, `tenant.ts` membresía) + migración 037 (REVOKE RPC). → Desactiva ambos vectores P0 en el mismo ciclo.
3. **C2:** migración 038 (RLS + revoke) + lockout de `failed_attempts` + limiter dedicado.
4. **C4:** migración 039 (drop policy + revoke UPDATE) + eliminar `useRealtimeSeats.updateSeatStatus`.
5. **C1 Fase 2 (RLS):** reescritura de políticas con `EXISTS` sobre `public.users`.
6. **C1 Fase 3 (opcional):** Custom Access Token Hook.
7. **C1 Fase 4:** middleware Next.js DB-backed + limpieza de claims.
8. **Checklist (sección 5)** en staging → producción.

**Prioridad condicional:** ejecutar las pruebas 3.3 y 4.3 en producción ANTES del plan si se quiere confirmar si C2/C4 deben escalar de P1 a P0.
