'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { User } from '@supabase/supabase-js';

export function AuthNav() {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [supabase]);

  return (
    <div className="flex gap-2 sm:gap-3 items-center">
      {user ? (
        <>
          {user.user_metadata?.role === 'admin' && (
            <Link
              href="/admin"
              className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-amber-300 hover:text-amber-200 transition-colors whitespace-nowrap"
            >
              Admin
            </Link>
          )}
          <Link
            href="/dashboard"
            className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-white bg-brand-cyan rounded-xl hover:bg-brand-cyan-light transition-colors shadow-md shadow-brand-cyan/20 whitespace-nowrap"
          >
            Mis reservas
          </Link>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.push('/login');
              router.refresh();
            }}
            className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-red-300 hover:text-red-200 transition-colors whitespace-nowrap"
          >
            Cerrar sesión
          </button>
        </>
      ) : (
        <>
          <Link
            href="/login"
            className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-white/70 hover:text-white transition-colors whitespace-nowrap"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/register"
            className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-white bg-brand-cyan rounded-xl hover:bg-brand-cyan-light transition-colors shadow-md shadow-brand-cyan/20 whitespace-nowrap"
          >
            Registrarse
          </Link>
        </>
      )}
    </div>
  );
}
