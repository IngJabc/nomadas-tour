'use client';

export function CancelBookingButton() {
  return (
    <button
      type="button"
      onClick={() => alert('Función de cancelación próximamente')}
      style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
      className="hover:underline"
    >
      Cancelar reserva
    </button>
  );
}
