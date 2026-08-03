interface SidebarBrandProps {
  logo?: React.ReactNode;
  brandTitle?: string;
  brandSubtitle?: string;
}

/** Purely visual sidebar identity block — no admin/agency/tenant knowledge. */
export function SidebarBrand({ logo, brandTitle, brandSubtitle }: SidebarBrandProps) {
  if (!logo && !brandTitle && !brandSubtitle) {
    return null;
  }

  return (
    <div className="px-6 pt-8 pb-4 flex flex-col items-center">
      {logo && (
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
          {logo}
        </div>
      )}
      {brandTitle && (
        <p className="mt-2 font-[family-name:var(--font-heading)] font-bold text-xs text-white text-center leading-snug px-1">
          {brandTitle}
        </p>
      )}
      {brandSubtitle && (
        <div className={`${brandTitle ? 'mt-1.5' : 'mt-2'} px-2 py-0.5 rounded bg-[var(--color-cyan-bg)]`}>
          <span className="font-[family-name:var(--font-body)] font-semibold text-[10px] text-[var(--color-brand-cyan)] uppercase tracking-wider">
            {brandSubtitle}
          </span>
        </div>
      )}
    </div>
  );
}
