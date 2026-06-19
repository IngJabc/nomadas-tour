export const BUS_LAYOUT = {
  totalSeats: 30,
  guideSeats: ['G'],
  rows: [
    { left: ['A29', 'A30'], right: ['A15', 'A16'] },
    { left: ['A27', 'A28'], right: ['A13', 'A14'] },
    { left: ['A25', 'A26'], right: ['A11', 'A12'] },
    { left: ['A23', 'A24'], right: ['A9', 'A10'] },
    { left: ['A21', 'A22'], right: ['A7', 'A8'] },
    { left: ['A19', 'A20'], right: ['A5', 'A6'] },
    { left: ['A17', 'A18'], right: ['A3', 'A4'] },
    { left: [null, null], right: ['A1', 'A2'] },
  ],
  frontLeft: 'G',
} as const;
