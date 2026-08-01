export type AppRole = 'superadmin' | 'agency';

/** Application identity from public.users via GET /auth/me */
export interface AppUser {
  id: string;
  email: string;
  role: AppRole;
  agency_id: string | null;
}
