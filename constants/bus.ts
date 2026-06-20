import { BusRow } from "@/types";

export const GUIDE_SEAT = "G";

export function generateBusLayout(totalSeats: number): {
  rows: BusRow[];
  frontLeft: string;
  totalSeats: number;
  guideSeats: string[];
} {
  const rows: BusRow[] = [];

  // Generamos la lista de asientos secuenciales (A1, A2, A3...)
  const allSeats: string[] = [];
  for (let i = 1; i <= totalSeats; i++) {
    allSeats.push(`A${i}`);
  }

  let idx = 0;

  // 1. Fila de la puerta (Siempre toma los 2 primeros asientos en la parte derecha)
  const doorRight: [string | null, string | null] = [
    allSeats[idx++] ?? null,
    allSeats[idx++] ?? null,
  ];
  rows.push({ left: [null, null], right: doorRight });

  // Asientos restantes después de la puerta
  const remainingSeats = totalSeats - idx;

  if (remainingSeats > 0) {
    // Calculamos cuántos asientos van al fondo (el residuo de filas de 4)
    // Si el residuo es 0, significa que la última fila tendría 4 asientos completos.
    let backRowSeatsCount = remainingSeats % 4;
    if (backRowSeatsCount === 0) {
      backRowSeatsCount = 4;
    }
    // Si por alguna razón da más de 5 (casos raros de configuración), lo limitamos a un rango lógico
    if (backRowSeatsCount > 5) {
      backRowSeatsCount = 5;
    }

    // El resto de asientos se distribuyen en filas normales de 4 puestos
    const normalSeatsCount = remainingSeats - backRowSeatsCount;
    const normalRowCount = Math.floor(normalSeatsCount / 4);

    // 2. Generamos las filas normales (2 a la izquierda, 2 a la derecha)
    for (let r = 0; r < normalRowCount; r++) {
      rows.push({
        left: [allSeats[idx++] ?? null, allSeats[idx++] ?? null],
        right: [allSeats[idx++] ?? null, allSeats[idx++] ?? null],
      });
    }

    // 3. Generamos la última fila (Fondo) con los asientos restantes perfectamente agrupados
    const backRowSeats: string[] = [];
    while (idx < totalSeats) {
      const seat = allSeats[idx++];
      if (seat) backRowSeats.push(seat);
    }

    if (backRowSeats.length > 0) {
      // Los guardamos en 'left' y dejamos 'right' vacío para que el componente sepa que es el fondo
      rows.push({ left: backRowSeats, right: [] });
    }
  }

  return {
    rows,
    frontLeft: GUIDE_SEAT,
    totalSeats,
    guideSeats: [GUIDE_SEAT],
  };
}

// Layout por defecto
export const BUS_LAYOUT = generateBusLayout(31);
