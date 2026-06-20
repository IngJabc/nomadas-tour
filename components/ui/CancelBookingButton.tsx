'use client';

export function CancelBookingButton() {
  return (
    <button
      type="button"
      onClick={() => alert('Función de cancelación próximamente')}
      className="font-['Poppins',sans-serif] font-normal text-[13px] text-red-500 bg-none border-none cursor-pointer hover:underline"
    >
      Cancelar reserva
    </button>
  );
}
