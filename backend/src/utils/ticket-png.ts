import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import satori, { type FontWeight } from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { TicketPNGTemplate } from '../templates/ticket-png.js';
import type { TicketData } from '../types/reservation.js';

interface FontData {
  data: Buffer;
  name: string;
  weight: FontWeight;
}

let cachedFonts: FontData[] | null = null;

function loadFonts(): FontData[] {
  if (cachedFonts) return cachedFonts;

  const fontsDir = join(import.meta.dirname, '..', '..', 'fonts');

  cachedFonts = [
    {
      data: readFileSync(join(fontsDir, 'Montserrat-Bold.ttf')),
      name: 'Montserrat',
      weight: 700,
    },
    {
      data: readFileSync(join(fontsDir, 'Poppins-Regular.ttf')),
      name: 'Poppins',
      weight: 400,
    },
    {
      data: readFileSync(join(fontsDir, 'Poppins-SemiBold.ttf')),
      name: 'Poppins',
      weight: 600,
    },
  ];

  return cachedFonts;
}

export async function generateTicketPNG(ticket: TicketData): Promise<Buffer> {
  const fonts = loadFonts();

  const element = TicketPNGTemplate({ ticket });

  const svg = await satori(element, {
    width: 400,
    fonts,
    embedFont: true,
  });

  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: false,
    },
    logLevel: 'off',
  });

  const pngData = resvg.render();
  return pngData.asPng();
}
