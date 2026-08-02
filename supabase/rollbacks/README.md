# Manual rollbacks (NOT auto-applied)

Scripts in this folder are **never** run by Supabase CLI migration pipeline.

Apply only manually in SQL Editor during an incident, with explicit approval.

| File | Purpose |
|------|---------|
| [`038_revert_036_rls.sql`](038_revert_036_rls.sql) | Manual rollback of `036_rls_identity_from_public_users.sql` — **restores user_metadata RLS (insecure)** |
| [`039_rollback_restore_metadata_rls.sql`](039_rollback_restore_metadata_rls.sql) | Emergency rollback of `039_rls_identity_from_public_users_v2.sql` — **restores user_metadata RLS (insecure)** |

After any rollback, re-apply the secure migration from [`../migrations/039_rls_identity_from_public_users_v2.sql`](../migrations/039_rls_identity_from_public_users_v2.sql) once stable.
