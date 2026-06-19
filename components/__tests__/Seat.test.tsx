import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Seat } from '@/components/bus/Seat';

function createSeat(overrides = {}) {
  return {
    id: 'seat-1',
    trip_id: 'trip-1',
    seat_code: 'A1',
    status: 'available' as const,
    locked_by: null,
    locked_at: null,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Seat component', () => {
  it('renders seat code', () => {
    render(<Seat seat={createSeat()} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByText('A1')).toBeDefined();
  });

  it('renders available seat with blue background', () => {
    render(<Seat seat={createSeat()} isSelected={false} onSelect={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-blue-500');
    expect(btn.className).toContain('cursor-pointer');
  });

  it('renders reserved seat with red background and disabled', () => {
    render(
      <Seat
        seat={createSeat({ status: 'reserved' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-red-500');
    expect(btn.className).toContain('cursor-not-allowed');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders locked seat with amber background and disabled', () => {
    render(
      <Seat
        seat={createSeat({ status: 'locked', locked_by: 'other-user' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-amber-500');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders selected seat as green regardless of status', () => {
    render(
      <Seat
        seat={createSeat({ status: 'locked', locked_by: 'my-user' })}
        isSelected={true}
        onSelect={() => {}}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-green-500');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders guide seat with dark green and disabled', () => {
    render(
      <Seat
        seat={createSeat({ seat_code: 'G', status: 'locked' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-green-800');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders null seat as empty div', () => {
    const { container } = render(<Seat seat={null} isSelected={false} onSelect={() => {}} />);
    expect(container.querySelector('div')).toBeTruthy();
    expect(container.querySelector('button')).toBeNull();
  });

  it('calls onSelect when clicking available seat', () => {
    const onSelect = vi.fn();
    render(<Seat seat={createSeat()} isSelected={false} onSelect={onSelect} />);
    screen.getByRole('button').click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect when clicking selected seat (deselect)', () => {
    const onSelect = vi.fn();
    render(
      <Seat
        seat={createSeat({ status: 'locked' })}
        isSelected={true}
        onSelect={onSelect}
      />,
    );
    screen.getByRole('button').click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not call onSelect when clicking reserved seat', () => {
    const onSelect = vi.fn();
    render(
      <Seat
        seat={createSeat({ status: 'reserved' })}
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    screen.getByRole('button').click();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
