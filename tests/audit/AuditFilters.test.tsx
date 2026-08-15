import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  AuditFilters,
  defaultAuditFilters,
  filtersToQueryParams,
} from '@/components/audit/AuditFilters';
import {
  dayRangeToUtc,
  isAuditCalendarRangeValid,
  presetToYmdRange,
} from '@/components/audit/audit-dates';

describe('audit-dates / filtersToQueryParams', () => {
  it('presets stay within 90 days and emit UTC from+to together', () => {
    for (const preset of ['today', '7d', '30d'] as const) {
      const range = presetToYmdRange(preset);
      expect(isAuditCalendarRangeValid(range.fromYmd, range.toYmd)).toBe(true);
      const utc = dayRangeToUtc(range.fromYmd, range.toYmd);
      expect(utc.from).toMatch(/Z$/);
      expect(utc.to).toMatch(/Z$/);
    }
  });

  it('rejects ranges over 90 calendar days', () => {
    expect(isAuditCalendarRangeValid('2026-01-01', '2026-05-01')).toBe(false);
  });

  it('filtersToQueryParams always includes from and to', () => {
    const state = defaultAuditFilters();
    const params = filtersToQueryParams(state, 'agency');
    expect(params?.from).toBeTruthy();
    expect(params?.to).toBeTruthy();
    expect(params).not.toHaveProperty('agency_id');
  });

  it('admin can include agency_id; agency role never does', () => {
    const state = {
      ...defaultAuditFilters(),
      agency_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    expect(filtersToQueryParams(state, 'superadmin')?.agency_id).toBe(
      state.agency_id,
    );
    expect(filtersToQueryParams(state, 'agency')?.agency_id).toBeUndefined();
  });
});

describe('AuditFilters UI', () => {
  it('renders admin agency filter and not for agency role', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AuditFilters
        role="superadmin"
        value={defaultAuditFilters()}
        onChange={onChange}
        agencies={[{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Central' }]}
      />,
    );
    expect(screen.getByText('Agencia')).toBeTruthy();
    expect(screen.getByText('Central')).toBeTruthy();

    rerender(
      <AuditFilters
        role="agency"
        value={defaultAuditFilters()}
        onChange={onChange}
      />,
    );
    expect(screen.queryByText('Central')).toBeNull();
  });

  it('clear restores defaults', () => {
    const onChange = vi.fn();
    const dirty = {
      ...defaultAuditFilters(),
      action: 'trip.created',
      preset: 'custom' as const,
    };
    render(
      <AuditFilters role="agency" value={dirty} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.action).toBe('');
    expect(next.preset).toBe('7d');
  });
});
