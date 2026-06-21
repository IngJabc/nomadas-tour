"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import Image from "next/image";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex pt-16">
      {/* LEFT: Hero column — hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col items-center justify-center overflow-hidden px-8 bg-gradient-to-br from-brand-dark to-brand-navy">
        {/* Mountain silhouette decoration */}
        <div
          className="absolute bottom-0 left-0 right-0 z-0 opacity-20 pointer-events-none"
          aria-hidden
        >
          <svg
            viewBox="0 0 1440 320"
            preserveAspectRatio="xMidYMax slice"
            className="w-full h-auto"
          >
            <path
              fill="#ffffff"
              d="M0,224L48,213.3C96,203,192,181,288,181.3C384,181,480,203,576,213.3C672,224,768,224,864,202.7C960,181,1056,139,1152,133.3C1248,128,1344,160,1392,176L1440,192L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
            <path
              fill="#ffffff"
              d="M0,256L48,245.3C96,235,192,213,288,213.3C384,213,480,235,576,245.3C672,256,768,256,864,240C960,224,1056,192,1152,181.3C1248,171,1344,197,1392,210.7L1440,224L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
              opacity="0.6"
            />
          </svg>
        </div>

        {/* Logo */}
        <div className="relative z-10 flex flex-col items-center">
          <Image
            src="/brand/logo-icon.svg"
            alt="Nómadas Tours"
            width={80}
            height={80}
            priority
          />
          <div className="mt-4             w-16 h-1 bg-brand-cyan rounded-sm" />
        </div>

        {/* Tagline */}
        <p className="relative z-10 mt-6 text-center font-['Poppins',sans-serif] font-normal text-lg text-white/70 max-w-[280px]">
          Viaja con nosotros, llega seguro
        </p>

        {/* Feature icons row */}
        <div className="relative z-10 mt-16 flex gap-8 sm:gap-12">
          <div className="flex flex-col items-center gap-2">
            <svg
              className="w-5 h-5 text-brand-cyan"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M3 13V6a2 2 0 012-2h14a2 2 0 012 2v7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 19a2 2 0 100-4 2 2 0 000 4zM19 19a2 2 0 100-4 2 2 0 000 4z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-['Poppins',sans-serif] font-normal text-xs text-white/60">
              Rutas seguras
            </span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <svg
              className="w-5 h-5 text-brand-cyan"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M9 12l2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20 12a8 8 0 11-16 0 8 8 0 0116 0z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-['Poppins',sans-serif] font-normal text-xs text-white/60">
              Reserva en minutos
            </span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <svg
              className="w-5 h-5 text-brand-cyan"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-['Poppins',sans-serif] font-normal text-xs text-white/60">
              Seguimiento en tiempo real
            </span>
          </div>
        </div>
      </div>

      {/* RIGHT: Form column */}
      <div className="w-full lg:w-1/2 flex items-start lg:items-center justify-center px-5 sm:px-8 lg:px-12 py-8 sm:py-12 bg-brand-surface">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-sm"
        >
          {/* Mobile-only small logo */}
          <div className="lg:hidden flex justify-center mb-5">
            <div className="w-9 h-9 bg-brand-navy rounded-xl flex items-center justify-center">
              <span className="font-['Montserrat',sans-serif] font-extrabold text-base text-white">
                N
              </span>
            </div>
          </div>

          {/* Back link */}
          <Link
            href="/"
            className="inline-flex items-center gap-1 mb-5 sm:mb-6 font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Volver al inicio
          </Link>

          {/* Title */}
          <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[24px] sm:text-[28px] text-brand-navy">
            Bienvenido de vuelta
          </h1>
          <p className="mt-2 mb-6 sm:mb-8 font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">
            Accede a tu cuenta para gestionar tus reservas
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block mb-1.5 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
                Correo electrónico
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="ejemplo@correo.com"
                  className="w-full border-[1.5px] border-gray-200 rounded-xl py-3 pl-4 pr-10 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy bg-white outline-none transition-[border-color,box-shadow] duration-200"
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor =
                      "var(--color-brand-cyan)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(0,212,255,0.15)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e5e7eb";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-muted">
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
              </div>
            </div>

            <div>
              <label className="block mb-1.5 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Ingresa tu contraseña"
                  className="w-full border-[1.5px] border-gray-200 rounded-xl py-3 pl-4 pr-10 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy bg-white outline-none transition-[border-color,box-shadow] duration-200"
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor =
                      "var(--color-brand-cyan)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(0,212,255,0.15)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e5e7eb";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-brand-muted"
                  tabIndex={-1}
                  aria-label={
                    showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {showPassword ? (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242-4.242m4.243 4.242L21 21"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M10.5 10.5a3 3 0 004.243 4.243"
                        opacity="0"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  )}
                </button>
              </div>
              <div className="text-right mt-1.5">
                <button
                  type="button"
                  className="font-['Poppins',sans-serif] font-normal text-[13px] text-brand-cyan hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-sm font-medium bg-red-50 px-3 py-2 rounded-xl font-['Poppins',sans-serif] font-normal">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center h-12 text-white font-['Poppins',sans-serif] font-semibold text-[15px] rounded-xl border-none transition-colors duration-200"
              style={{
                background: loading
                  ? "var(--color-brand-blue)"
                  : "var(--color-brand-cyan)",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.8 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading)
                  e.currentTarget.style.background = "var(--color-brand-blue)";
              }}
              onMouseLeave={(e) => {
                if (!loading)
                  e.currentTarget.style.background = "var(--color-brand-cyan)";
              }}
            >
              {loading ? (
                <svg
                  className="animate-spin h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
                "Ingresar"
              )}
            </button>
          </form>

          {/* Separator */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted">
              o
            </span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Register link */}
          <p className="text-center font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">
            ¿No tienes cuenta?{" "}
            <Link
              href="/register"
              className="font-['Poppins',sans-serif] font-semibold text-brand-cyan hover:underline"
            >
              Regístrate aquí
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
