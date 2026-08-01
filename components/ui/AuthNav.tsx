'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthUser } from '@/hooks/useAuthUser';

export function AuthNav() {
  const { user, loading, signOut } = useAuthUser();
  const router = useRouter();

  if (loading) {
    return null;
  }

  return (
    <div className="flex gap-2 sm:gap-3 items-center">
      {user ? (
        <>
          {user.role === 'superadmin' && (
            <Link
              href="/admin"
              className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-amber-300 hover:text-amber-200 transition-colors whitespace-nowrap"
            >
              Admin
            </Link>
          )}
          <button
            onClick={async () => {
              await signOut();
              router.push('/login');
              router.refresh();
            }}
            className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-red-300 hover:text-red-200 transition-colors whitespace-nowrap"
          >
            Cerrar sesión
          </button>
        </>
      ) : (
        <Link
          href="/login"
          className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-white bg-brand-cyan rounded-xl hover:bg-brand-blue transition-colors shadow-md shadow-brand-cyan/20 whitespace-nowrap"
        >
          Iniciar sesión
        </Link>
      )}
    </div>
  );
}
