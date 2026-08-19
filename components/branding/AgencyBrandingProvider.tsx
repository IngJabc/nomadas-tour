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
import { buildAgencyBrandingStyle, type BrandingStyle } from '@/lib/brand/utils';

const AgencyBrandingContext = createContext<AgencyBrandingContextValue | null>(null);

interface AgencyBrandingContextValue {
  branding: AgencyBrandingSettings | null;
  loading: boolean;
  error: boolean;
  updateBranding: (branding: AgencyBrandingSettings) => void;
  refresh: () => Promise<void>;
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
