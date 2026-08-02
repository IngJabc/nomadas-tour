# SEC-007 — Security regression tests

Automated guards against C1 identity forgery regressions and unsafe reintroduction of `user_metadata` authorization.

## Run

```bash
npm run test:security
```

Full verification (recommended before release):

```bash
npm run test:security
npm test
npm test --prefix backend
```

## What each file covers

| File | Purpose |
|------|---------|
| `identity-forgery.backend.test.ts` | **Critical chain:** forged JWT `user_metadata.role=superadmin` + `public.users.role=agency` → backend keeps `agency`; `authorize('superadmin')` rejects |
| `identity-forgery.frontend.test.tsx` | UI contract: `useAuthUser().user.role` from `/auth/me` — not metadata |
| `no-user-metadata-in-source.test.ts` | Fails CI if `user_metadata` appears in executable app/backend source |
| `rls-active-migrations.test.ts` | Active migration `039` policies use `private.auth_app_*`, not `user_metadata` |

## Allowlist (temporary)

`backend/src/services/auth.service.ts` — accept-invitation still writes metadata until post-SEC-007 cleanup.

## Not covered here

- Live Supabase `updateUser` E2E (manual validation documented in `docs/security-hardening-implementation.md`)
- Historical migrations (038, rollback, etc.)
