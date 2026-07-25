import { useState, useEffect, type CSSProperties, type ReactNode } from "react";

// ── Variant ────────────────────────────────────────────────────────────────

export type ToastVariant =
  | "success"
  | "error"
  | "blank"
  | "loading"
  | "notification";

// ── Animation constants ────────────────────────────────────────────────────

const TOAST_TRANSITION =
  "opacity 200ms ease, transform 200ms ease, translate 200ms ease";
const TOAST_ENTER_OFFSET = 24;
const TOAST_ENTER_SCALE = 0.96;
const TOAST_MAX_WIDTH = 360;

// ── Variant config (data-driven, no conditionals) ──────────────────────────

interface VariantStyle {
  layout: string;
  theme: string;
}

const VARIANT_STYLES: Record<ToastVariant, VariantStyle> = {
  success: {
    layout: "flex items-center gap-2.5 px-4 py-3",
    theme: "bg-[var(--color-brand-navy)] text-[var(--color-brand-surface)]",
  },
  error: {
    layout: "flex items-center gap-2.5 px-4 py-3",
    theme: "bg-[var(--color-brand-navy)] text-[var(--color-brand-surface)]",
  },
  blank: {
    layout: "flex items-center gap-2.5 px-4 py-3",
    theme: "bg-[var(--color-brand-navy)] text-[var(--color-brand-surface)]",
  },
  loading: {
    layout: "flex items-center gap-2.5 px-4 py-3",
    theme: "bg-[var(--color-brand-navy)] text-[var(--color-brand-surface)]",
  },
  notification: {
    layout: "flex items-start gap-3 p-3 cursor-pointer text-left",
    theme: "bg-white text-[var(--color-brand-navy)]",
  },
};

// ── Shared base classes (hover, radius, shadow, transition) ────────────────

const BASE_CLASSES =
  "rounded-xl shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg";

// ── Animation style ────────────────────────────────────────────────────────

function toastAnimation(hasMounted: boolean, visible: boolean): CSSProperties {
  const isVisible = hasMounted && visible;

  return {
    opacity: isVisible ? 1 : 0,
    transform: isVisible
      ? "translateX(0) scale(1)"
      : `translateX(${TOAST_ENTER_OFFSET}px) scale(${TOAST_ENTER_SCALE})`,
    transition: TOAST_TRANSITION,
  };
}

// ── Props ──────────────────────────────────────────────────────────────────

interface BaseToastProps {
  variant: ToastVariant;
  visible: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  children: ReactNode;
}

// ── Component ──────────────────────────────────────────────────────────────

export function BaseToast({
  variant,
  visible,
  icon,
  onClick,
  children,
}: BaseToastProps) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setHasMounted(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const cfg = VARIANT_STYLES[variant];
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={`${BASE_CLASSES} ${cfg.layout} ${cfg.theme}`}
      style={{ maxWidth: TOAST_MAX_WIDTH, ...toastAnimation(hasMounted, visible) }}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1 min-w-0">{children}</span>
    </Tag>
  );
}
