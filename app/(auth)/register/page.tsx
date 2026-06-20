"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import Image from "next/image";

function passwordStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: "Contraseña débil", color: "#ef4444" };
  if (score === 2)
    return { score, label: "Contraseña regular", color: "#f59e0b" };
  if (score === 3)
    return {
      score,
      label: "Contraseña buena",
      color: "var(--color-brand-cyan)",
    };
  return { score: 4, label: "Contraseña fuerte", color: "#10b981" };
}

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const strength = useMemo(() => passwordStrength(password), [password]);
  const showStrength =
    (passwordFocused || password.length > 0) && password.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (!acceptedTerms) return;
    setLoading(true);
    setError(null);

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },
        },
      });

      if (signUpError) throw signUpError;
      router.push("/login?registered=true");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrarse");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* LEFT: Hero column — hidden on mobile (same as Login) */}
      <div
        className="hidden lg:flex lg:w-1/2 relative flex-col items-center justify-center overflow-hidden px-8"
        style={{
          background:
            "linear-gradient(135deg, var(--color-brand-dark), var(--color-brand-navy))",
        }}
      >
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

        <div className="relative z-10 flex flex-col items-center">
          <Image
            src="/brand/logo-icon.svg"
            alt="Nómadas Tours"
            width={80}
            height={80}
            priority
          />
          <div
            className="mt-4"
            style={{
              width: 60,
              height: 4,
              background: "var(--color-brand-cyan)",
              borderRadius: 2,
            }}
          />
        </div>

        <p
          className="relative z-10 mt-6 text-center"
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 400,
            fontSize: 18,
            color: "rgba(255,255,255,0.7)",
            maxWidth: 280,
          }}
        >
          Viaja con nosotros, llega seguro
        </p>

        <div className="relative z-10 mt-16 flex gap-8 sm:gap-12">
          <div className="flex flex-col items-center gap-2">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              style={{ color: "var(--color-brand-cyan)" }}
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
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 400,
                fontSize: 12,
                color: "rgba(255,255,255,0.6)",
              }}
            >
              Rutas seguras
            </span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              style={{ color: "var(--color-brand-cyan)" }}
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
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 400,
                fontSize: 12,
                color: "rgba(255,255,255,0.6)",
              }}
            >
              Reserva en minutos
            </span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              style={{ color: "var(--color-brand-cyan)" }}
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
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 400,
                fontSize: 12,
                color: "rgba(255,255,255,0.6)",
              }}
            >
              Seguimiento en tiempo real
            </span>
          </div>
        </div>
      </div>

      {/* RIGHT: Form column */}
      <div
        className="w-full lg:w-1/2 flex items-center justify-center px-8 sm:px-12 py-12"
        style={{ background: "var(--color-brand-surface)" }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-sm"
        >
          {/* Mobile-only small logo */}
          <div className="lg:hidden flex justify-center mb-6">
            <div
              style={{
                width: 32,
                height: 32,
                background: "var(--color-brand-navy)",
                borderRadius: 8,
              }}
              className="flex items-center justify-center"
            >
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: 16,
                  color: "#ffffff",
                }}
              >
                N
              </span>
            </div>
          </div>

          <Link
            href="/"
            className="inline-flex items-center gap-1 mb-6"
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 400,
              fontSize: 13,
              color: "var(--color-brand-muted)",
            }}
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

          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 800,
              fontSize: 28,
              color: "var(--color-brand-navy)",
            }}
          >
            Crea tu cuenta
          </h1>
          <p
            className="mt-2 mb-8"
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 400,
              fontSize: 14,
              color: "var(--color-brand-muted)",
            }}
          >
            Únete y reserva tus asientos en segundos
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label
                className="block mb-1.5"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  fontSize: 12,
                  color: "var(--color-brand-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Nombre completo
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Tu nombre completo"
                  className="w-full"
                  style={{
                    border: "1.5px solid #e5e7eb",
                    borderRadius: 10,
                    padding: "12px 40px 12px 16px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 400,
                    fontSize: 14,
                    color: "var(--color-brand-navy)",
                    background: "#ffffff",
                    outline: "none",
                    transition: "border-color 200ms, box-shadow 200ms",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor =
                      "var(--color-brand-cyan)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(8,142,184,0.15)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e5e7eb";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
                <div
                  className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "var(--color-brand-muted)" }}
                >
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
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Email */}
            <div>
              <label
                className="block mb-1.5"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  fontSize: 12,
                  color: "var(--color-brand-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Correo electrónico
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="ejemplo@correo.com"
                  className="w-full"
                  style={{
                    border: "1.5px solid #e5e7eb",
                    borderRadius: 10,
                    padding: "12px 40px 12px 16px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 400,
                    fontSize: 14,
                    color: "var(--color-brand-navy)",
                    background: "#ffffff",
                    outline: "none",
                    transition: "border-color 200ms, box-shadow 200ms",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor =
                      "var(--color-brand-cyan)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(8,142,184,0.15)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e5e7eb";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
                <div
                  className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "var(--color-brand-muted)" }}
                >
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

            {/* Password */}
            <div>
              <label
                className="block mb-1.5"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  fontSize: 12,
                  color: "var(--color-brand-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full"
                  style={{
                    border: "1.5px solid #e5e7eb",
                    borderRadius: 10,
                    padding: "12px 40px 12px 16px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 400,
                    fontSize: 14,
                    color: "var(--color-brand-navy)",
                    background: "#ffffff",
                    outline: "none",
                    transition: "border-color 200ms, box-shadow 200ms",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor =
                      "var(--color-brand-cyan)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(8,142,184,0.15)";
                    setPasswordFocused(true);
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e5e7eb";
                    e.currentTarget.style.boxShadow = "none";
                    setPasswordFocused(false);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5"
                  style={{ color: "var(--color-brand-muted)" }}
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
              {/* Strength indicator */}
              {showStrength && (
                <div className="mt-2">
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4].map((segment) => (
                      <div
                        key={segment}
                        className="h-1 flex-1 rounded-full transition-colors duration-200"
                        style={{
                          background:
                            segment <= strength.score
                              ? strength.color
                              : "#e5e7eb",
                        }}
                      />
                    ))}
                  </div>
                  <p
                    className="mt-1"
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontWeight: 400,
                      fontSize: 11,
                      color: strength.color,
                    }}
                  >
                    {strength.label}
                  </p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label
                className="block mb-1.5"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  fontSize: 12,
                  color: "var(--color-brand-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Confirmar contraseña
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Repite la contraseña"
                  className="w-full"
                  style={{
                    border: "1.5px solid #e5e7eb",
                    borderRadius: 10,
                    padding: "12px 40px 12px 16px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 400,
                    fontSize: 14,
                    color: "var(--color-brand-navy)",
                    background: "#ffffff",
                    outline: "none",
                    transition: "border-color 200ms, box-shadow 200ms",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor =
                      "var(--color-brand-cyan)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(8,142,184,0.15)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e5e7eb";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5"
                  style={{ color: "var(--color-brand-muted)" }}
                  tabIndex={-1}
                  aria-label={
                    showConfirm ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {showConfirm ? (
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
                        d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1112 3a9 9 0 017.364 4.636z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p
                className="text-red-400 text-sm font-medium bg-red-50 px-3 py-2 rounded-xl"
                style={{ fontFamily: "var(--font-sans)", fontWeight: 400 }}
              >
                {error}
              </p>
            )}

            {/* Terms checkbox */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 shrink-0"
                style={{
                  width: 16,
                  height: 16,
                  accentColor: "var(--color-brand-cyan)",
                  borderRadius: 4,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 400,
                  fontSize: 12,
                  color: "var(--color-brand-muted)",
                }}
              >
                Acepto los{" "}
                <span
                  style={{ color: "var(--color-brand-cyan)" }}
                  className="hover:underline"
                >
                  Términos y Condiciones
                </span>{" "}
                y la{" "}
                <span
                  style={{ color: "var(--color-brand-cyan)" }}
                  className="hover:underline"
                >
                  Política de Privacidad
                </span>
              </span>
            </label>

            <button
              type="submit"
              disabled={loading || !acceptedTerms}
              className="w-full flex items-center justify-center"
              style={{
                height: 48,
                background: loading
                  ? "var(--color-brand-blue)"
                  : "var(--color-brand-cyan)",
                color: "#ffffff",
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                fontSize: 15,
                borderRadius: 10,
                border: "none",
                cursor: loading || !acceptedTerms ? "not-allowed" : "pointer",
                transition: "background 200ms",
                opacity: loading || !acceptedTerms ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading && acceptedTerms)
                  e.currentTarget.style.background = "var(--color-brand-blue)";
              }}
              onMouseLeave={(e) => {
                if (!loading && acceptedTerms)
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
                "Crear cuenta"
              )}
            </button>
          </form>

          {/* Footer */}
          <p
            className="text-center mt-6"
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 400,
              fontSize: 14,
              color: "var(--color-brand-muted)",
            }}
          >
            ¿Ya tienes cuenta?{" "}
            <Link
              href="/login"
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                color: "var(--color-brand-cyan)",
              }}
              className="hover:underline"
            >
              Inicia sesión
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
