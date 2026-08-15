'use client';

import { useEffect, useMemo, useState } from 'react';
import { DatePicker } from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  ACTION_OPTIONS,
  ENTITY_TYPE_OPTIONS,
} from '@/components/audit/audit-config';
import {
  dayRangeToUtc,
  isAuditCalendarRangeValid,
  isUuid,
  presetToYmdRange,
  type DatePreset,
} from '@/components/audit/audit-dates';
import { cn } from '@/lib/utils';
import type { AuditQueryParams } from '@/types/audit';

export interface AuditFilterState {
  preset: DatePreset;
  fromYmd: string;
  toYmd: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string;
  agency_id: string;
}

export function defaultAuditFilters(): AuditFilterState {
  const range = presetToYmdRange('7d');
  return {
    preset: '7d',
    fromYmd: range.fromYmd,
    toYmd: range.toYmd,
    action: '',
    entity_type: '',
    entity_id: '',
    actor_user_id: '',
    agency_id: '',
  };
}

/** Build API params. Always sends from+to together. */
export function filtersToQueryParams(
  state: AuditFilterState,
  role: 'superadmin' | 'agency',
): AuditQueryParams | null {
  if (!isAuditCalendarRangeValid(state.fromYmd, state.toYmd)) {
    return null;
  }
  const { from, to } = dayRangeToUtc(state.fromYmd, state.toYmd);
  const params: AuditQueryParams = { from, to, limit: '50' };
  if (state.action) params.action = state.action;
  if (state.entity_type) params.entity_type = state.entity_type;
  if (state.entity_id.trim()) {
    if (!state.entity_type || !isUuid(state.entity_id.trim())) return null;
    params.entity_id = state.entity_id.trim();
  }
  if (state.actor_user_id.trim()) {
    if (!isUuid(state.actor_user_id.trim())) return null;
    params.actor_user_id = state.actor_user_id.trim();
  }
  if (role === 'superadmin' && state.agency_id.trim()) {
    if (!isUuid(state.agency_id.trim())) return null;
    params.agency_id = state.agency_id.trim();
  }
  return params;
}

export function hasActiveNonDateFilters(state: AuditFilterState): boolean {
  return Boolean(
    state.action ||
      state.entity_type ||
      state.entity_id.trim() ||
      state.actor_user_id.trim() ||
      state.agency_id.trim(),
  );
}

interface AgencyOption {
  id: string;
  name: string;
}

interface AuditFiltersProps {
  role: 'superadmin' | 'agency';
  value: AuditFilterState;
  onChange: (next: AuditFilterState) => void;
  agencies?: AgencyOption[];
  className?: string;
}

const PRESET_BUTTONS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: '7d', label: 'Últimos 7 días' },
  { id: '30d', label: 'Últimos 30 días' },
  { id: 'custom', label: 'Personalizado' },
];

export function AuditFilters({
  role,
  value,
  onChange,
  agencies = [],
  className,
}: AuditFiltersProps) {
  const [entityDraft, setEntityDraft] = useState(value.entity_id);
  const [actorDraft, setActorDraft] = useState(value.actor_user_id);
  const [agencyDraft, setAgencyDraft] = useState(value.agency_id);

  useEffect(() => setEntityDraft(value.entity_id), [value.entity_id]);
  useEffect(() => setActorDraft(value.actor_user_id), [value.actor_user_id]);
  useEffect(() => setAgencyDraft(value.agency_id), [value.agency_id]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (entityDraft !== value.entity_id) {
        onChange({ ...value, entity_id: entityDraft });
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [entityDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (actorDraft !== value.actor_user_id) {
        onChange({ ...value, actor_user_id: actorDraft });
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [actorDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (role !== 'superadmin') return;
    const t = window.setTimeout(() => {
      if (agencyDraft !== value.agency_id) {
        onChange({ ...value, agency_id: agencyDraft });
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [agencyDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const rangeError = useMemo(() => {
    if (!value.fromYmd || !value.toYmd) return 'Selecciona un rango de fechas';
    if (value.toYmd < value.fromYmd) return 'La fecha final debe ser ≥ inicial';
    if (!isAuditCalendarRangeValid(value.fromYmd, value.toYmd)) {
      return 'El rango no puede superar 90 días';
    }
    return null;
  }, [value.fromYmd, value.toYmd]);

  const entityHint =
    entityDraft.trim() && !value.entity_type
      ? 'Requiere tipo de entidad'
      : entityDraft.trim() && !isUuid(entityDraft)
        ? 'UUID inválido'
        : undefined;

  return (
    <div
      className={cn(
        'rounded-2xl border border-[rgba(0,0,0,0.06)] bg-[var(--color-brand-surface)] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:p-5',
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {PRESET_BUTTONS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              if (p.id === 'custom') {
                onChange({ ...value, preset: 'custom' });
                return;
              }
              const range = presetToYmdRange(p.id);
              onChange({
                ...value,
                preset: p.id,
                fromYmd: range.fromYmd,
                toYmd: range.toYmd,
              });
            }}
            className={cn(
              'rounded-full border-none px-3 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-brand-cyan)]',
              value.preset === p.id
                ? 'bg-[var(--color-brand-cyan)] text-white'
                : 'bg-slate-100 text-[var(--color-brand-navy)] hover:bg-slate-200',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <label className="mb-1.5 block font-[family-name:var(--font-body)] text-[12px] font-medium uppercase text-[var(--color-brand-muted)]">
            Desde
          </label>
          <DatePicker
            value={value.fromYmd}
            onChange={(fromYmd) =>
              onChange({ ...value, preset: 'custom', fromYmd })
            }
            placeholder="Desde"
          />
        </div>
        <div>
          <label className="mb-1.5 block font-[family-name:var(--font-body)] text-[12px] font-medium uppercase text-[var(--color-brand-muted)]">
            Hasta
          </label>
          <DatePicker
            value={value.toYmd}
            onChange={(toYmd) =>
              onChange({ ...value, preset: 'custom', toYmd })
            }
            placeholder="Hasta"
          />
        </div>

        <div>
          <label className="mb-1.5 block font-[family-name:var(--font-body)] text-[12px] font-medium uppercase text-[var(--color-brand-muted)]">
            Acción
          </label>
          <select
            value={value.action}
            onChange={(e) => onChange({ ...value, action: e.target.value })}
            className="w-full rounded-[10px] border-[1.5px] border-[#e5e7eb] bg-white px-4 py-3 font-[family-name:var(--font-body)] text-[14px] text-[var(--color-brand-navy)] outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
          >
            <option value="">Todas</option>
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block font-[family-name:var(--font-body)] text-[12px] font-medium uppercase text-[var(--color-brand-muted)]">
            Tipo de entidad
          </label>
          <select
            value={value.entity_type}
            onChange={(e) =>
              onChange({ ...value, entity_type: e.target.value })
            }
            className="w-full rounded-[10px] border-[1.5px] border-[#e5e7eb] bg-white px-4 py-3 font-[family-name:var(--font-body)] text-[14px] text-[var(--color-brand-navy)] outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
          >
            <option value="">Todos</option>
            {ENTITY_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="ID de entidad"
          value={entityDraft}
          onChange={(e) => setEntityDraft(e.target.value)}
          placeholder="UUID"
          helperText={entityHint ?? 'Requiere tipo de entidad'}
        />

        <Input
          label="Actor (user id)"
          value={actorDraft}
          onChange={(e) => setActorDraft(e.target.value)}
          placeholder="UUID técnico"
          helperText={
            actorDraft.trim() && !isUuid(actorDraft)
              ? 'UUID inválido'
              : 'Identificador técnico, no nombre'
          }
        />

        {role === 'superadmin' && (
          <div>
            <label className="mb-1.5 block font-[family-name:var(--font-body)] text-[12px] font-medium uppercase text-[var(--color-brand-muted)]">
              Agencia
            </label>
            {agencies.length > 0 ? (
              <select
                value={value.agency_id}
                onChange={(e) =>
                  onChange({ ...value, agency_id: e.target.value })
                }
                className="w-full rounded-[10px] border-[1.5px] border-[#e5e7eb] bg-white px-4 py-3 font-[family-name:var(--font-body)] text-[14px] text-[var(--color-brand-navy)] outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
              >
                <option value="">Todas</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                label="Agencia (UUID)"
                value={agencyDraft}
                onChange={(e) => setAgencyDraft(e.target.value)}
                placeholder="UUID de agencia"
              />
            )}
          </div>
        )}
      </div>

      {rangeError && (
        <p className="mt-3 text-[13px] font-medium text-[#ef4444]" role="alert">
          {rangeError}
        </p>
      )}

      <div className="mt-4">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange(defaultAuditFilters())}
        >
          Limpiar
        </Button>
      </div>
    </div>
  );
}
