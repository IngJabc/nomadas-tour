'use client';

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  agencyApi,
  type AgencyBrandingSettings,
} from '@/lib/api';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

interface AgencyBrandingContextValue {
  branding: AgencyBrandingSettings | null;
  loading: boolean;
  error: boolean;
  updateBranding: (branding: AgencyBrandingSettings) => void;
  refresh: () => Promise<void>;
}

const AgencyBrandingContext =
  createContext<AgencyBrandingContextValue | null>(null);

type BrandingStyle = CSSProperties &
  Partial<Record<`--${string}`, string>>;

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

export function buildAgencyBrandingStyle(
  branding: Partial<AgencyBrandingSettings> | null,
): BrandingStyle {
  if (!branding) return {};

  const style: BrandingStyle = {};

  if (isHexColor(branding.accent_color)) {
    style['--color-brand-cyan'] = branding.accent_color;
    style['--color-cyan-bg'] =
      'color-mix(in srgb, var(--color-brand-cyan) 10%, transparent)';
  }

  if (isHexColor(branding.secondary_color)) {
    style['--color-brand-blue'] = branding.secondary_color;
    style['--color-brand-blue-bg'] =
      'color-mix(in srgb, var(--color-brand-blue) 10%, transparent)';
  }

  if (isHexColor(branding.primary_color)) {
    style['--color-brand-navy'] = branding.primary_color;
    style['--color-brand-dark'] =
      'color-mix(in srgb, var(--color-brand-navy) 34%, black)';
    style['--color-brand-mid'] =
      'color-mix(in srgb, var(--color-brand-navy) 96%, white)';
  }

  return style;
}

export function AgencyBrandingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [branding, setBranding] = useState<AgencyBrandingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const runtimeRevisionRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const mountedRef = useRef(false);

  const updateBranding = useCallback((nextBranding: AgencyBrandingSettings) => {
    runtimeRevisionRef.current += 1;
    setBranding({ ...nextBranding });
    setError(false);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current;
    const requestRevision = runtimeRevisionRef.current;
    setLoading(true);
    setError(false);

    try {
      const settings = await agencyApi.getBranding();
      if (
        !mountedRef.current ||
        requestSequenceRef.current !== requestSequence ||
        runtimeRevisionRef.current !== requestRevision
      ) {
        return;
      }
      setBranding(settings);
      setError(false);
    } catch {
      if (
        !mountedRef.current ||
        requestSequenceRef.current !== requestSequence ||
        runtimeRevisionRef.current !== requestRevision
      ) {
        return;
      }
      // No inline overrides means all platform defaults remain inherited.
      setBranding(null);
      setError(true);
    } finally {
      if (
        mountedRef.current &&
        requestSequenceRef.current === requestSequence &&
        runtimeRevisionRef.current === requestRevision
      ) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const style = useMemo(
    () => buildAgencyBrandingStyle(branding),
    [branding],
  );
  const value = useMemo(
    () => ({ branding, loading, error, updateBranding, refresh }),
    [branding, loading, error, updateBranding, refresh],
  );

  return (
    <AgencyBrandingContext.Provider value={value}>
      <div
        data-agency-branding-scope
        className="min-h-screen"
        style={style}
      >
        {children}
      </div>
    </AgencyBrandingContext.Provider>
  );
}

export function useAgencyBranding(): AgencyBrandingContextValue {
  const context = useContext(AgencyBrandingContext);
  if (!context) {
    throw new Error(
      'useAgencyBranding must be used within AgencyBrandingProvider',
    );
  }
  return context;
}
