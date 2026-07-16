"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Hide navbar on admin and agency pages (they have their own sidebar layout)
  if (pathname.startsWith("/admin") || pathname.startsWith("/agency")) return null;

  return (
    <header
      className="fixed top-0 z-50 w-full bg-brand-navy h-16"
      style={{
        boxShadow: scrolled ? "0 2px 12px rgba(0,0,0,0.4)" : "none",
      }}
    >
      <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-center">
        <Link href="/login" className="flex items-center gap-3">
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
    </header>
  );
}
