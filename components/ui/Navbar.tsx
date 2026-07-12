"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [user, setUser] = useState<any>(null);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    if (open) {
      document.body.classList.add('no-scroll');
    } else {
      document.body.classList.remove('no-scroll');
    }
    return () => document.body.classList.remove('no-scroll');
  }, [open]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));

    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);

    return () => {
      listener?.subscription.unsubscribe();
      window.removeEventListener("scroll", onScroll);
    };
  }, [supabase]);

  // Hide navbar on admin and agency pages (they have their own sidebar layout)
  if (pathname.startsWith("/admin") || pathname.startsWith("/agency")) return null;

  const handleSignOut = async () => {
    setOpen(false);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <header
      className="fixed top-0 z-50 w-full bg-brand-navy h-16"
      style={{
        boxShadow: scrolled ? "0 2px 12px rgba(0,0,0,0.4)" : "none",
      }}
    >
      <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/brand/logo-completo-blanco.svg"
              alt="Nómadas Tours"
              width={160}
              height={36}
              priority
              className="hidden sm:block"
            />
            <Image
              src="/brand/logo-icon.svg"
              alt="Nómadas Tours"
              width={32}
              height={32}
              priority
              className="sm:hidden"
            />
          </Link>
        </div>

        <nav className="hidden md:flex items-center gap-6">
          <Link
            href="/"
            className="text-white text-sm opacity-75 hover:opacity-100 transition-opacity duration-150"
          >
            Viajes
          </Link>
          {user?.user_metadata?.role === "superadmin" && (
            <Link
              href="/admin"
              className="text-white text-sm opacity-75 hover:opacity-100 transition-opacity duration-150"
            >
              Panel Admin
            </Link>
          )}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="px-5 py-2 rounded-full text-sm font-semibold bg-brand-cyan text-white font-['Poppins',sans-serif]"
              >
                Mis reservas
              </Link>

              <button
                onClick={handleSignOut}
                className="text-white text-sm opacity-75 hover:opacity-100 transition-opacity"
              >
                Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-white text-sm opacity-75 hover:opacity-100 transition-opacity"
              >
                Iniciar sesión
              </Link>
              <Link
                href="/register"
                className="px-5 py-2 rounded-full text-sm font-semibold bg-brand-cyan text-white font-['Poppins',sans-serif]"
              >
                Registrarse
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <div className="md:hidden">
          <button
            aria-label="Abrir menú"
            aria-expanded={open}
            onClick={() => setOpen((s) => !s)}
            className="p-3 inline-flex items-center justify-center rounded-md text-white"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={open ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"}
                stroke="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer backdrop */}
      <div
        className={`fixed inset-0 z-40 ${open ? "block" : "hidden"}`}
        aria-hidden={!open}
      >
        <div
          className="absolute inset-0 bg-black/40"
          onClick={() => setOpen(false)}
        />
      </div>

      <div
        role="dialog"
        aria-modal="true"
        className={`fixed top-0 right-0 h-full w-[280px] transform ${
          open ? "translate-x-0" : "translate-x-full"
        } transition-transform duration-200 z-50 bg-brand-dark`}
      >
        <div className="h-16 px-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 text-white"
            onClick={() => setOpen(false)}
          >
            <Image
              src="/brand/logo-icon.svg"
              alt="Nómadas Tours"
              width={28}
              height={28}
              priority
            />
          </Link>
          <button onClick={() => setOpen(false)} className="p-2 text-white">
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="px-4 py-6 flex flex-col gap-4">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="text-white text-base"
          >
            Viajes
          </Link>
          {user?.user_metadata?.role === "superadmin" && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="text-white text-base"
            >
              Panel Admin
            </Link>
          )}
        </div>

        <div className="mt-auto px-4 py-6 border-t border-white/10">
          {user ? (
            <>
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="block w-full text-center px-4 py-2 rounded-full bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold"
              >
                Mis reservas
              </Link>
              <button
                onClick={handleSignOut}
                className="mt-3 w-full text-white text-center"
              >
                Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className="block w-full text-center px-4 py-2 rounded-full bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold"
              >
                Registrarse
              </Link>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="block w-full text-center mt-3 text-white"
              >
                Iniciar sesión
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
