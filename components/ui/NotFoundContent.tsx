"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

export function NotFoundContent() {
  return (
    <div className="flex-1 flex items-center justify-center px-5 sm:px-8 bg-brand-surface pt-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-sm text-center"
      >
        <Image
          src="/brand/logo-icon.svg"
          alt="Nómadas Tours"
          width={48}
          height={48}
          priority
          className="mx-auto mb-6"
        />

        <div className="w-16 h-16 bg-[var(--color-brand-dark)] rounded-2xl flex items-center justify-center mx-auto mb-6">
          <AlertTriangle
            className="w-8 h-8 text-brand-cyan"
            strokeWidth={1.75}
            aria-hidden
          />
        </div>

        <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[28px] text-brand-navy">
          404
        </h1>

        <p className="mt-3 font-['Poppins',sans-serif] font-semibold text-[18px] text-brand-navy">
          Página no encontrada
        </p>

        <p className="mt-2 font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">
          La página que buscas no existe o ya no está disponible.
        </p>

        <Link href="/" className="inline-block mt-8">
          <button
            type="button"
            className="inline-flex items-center justify-center h-11 px-6 text-white font-['Poppins',sans-serif] font-semibold text-[14px] rounded-xl border-none transition-colors duration-200 cursor-pointer"
            style={{ background: "var(--color-brand-cyan)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-brand-blue)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--color-brand-cyan)";
            }}
          >
            Volver al inicio
          </button>
        </Link>
      </motion.div>
    </div>
  );
}
