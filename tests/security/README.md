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
| `no-user-metadata-in-source.test.ts` | Fails CI if `user_metadata` / `raw_user_meta_data` in executable app/backend source |
| `no-auth-metadata-writes.test.ts` | Fails CI if Auth admin/client writes role/agency via metadata |
| `no-rollback-in-migrations.test.ts` | No rollback/revert SQL auto-aplicable under `supabase/migrations/` |
| `no-dist-user-metadata.test.ts` | `backend/dist` gitignored; compiled auth sin metadata si dist existe |
| `rls-active-migrations.test.ts` | Active migration `039` policies use `private.auth_app_*`, not `user_metadata` |

## Allowlist

None — SEC-008 removed all `user_metadata` writes from executable source.

## Not covered here

- Live Supabase `updateUser` E2E (manual validation documented in `docs/security-hardening-implementation.md`)
- Historical migrations (038, rollback, etc.)
