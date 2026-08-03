import path from 'node:path';
import { supabaseAdmin } from '../config/database.js';
import { AppError, ValidationError } from '../errors/index.js';

export const AGENCY_ASSETS_BUCKET = 'agency-assets';
export const MAX_LOGO_BYTES = 1024 * 1024;

type SupportedLogoExtension = 'png' | 'jpg' | 'webp';
type SupportedLogoMime = 'image/png' | 'image/jpeg' | 'image/webp';

interface UploadAgencyLogoInput {
  agencyId: string;
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}

const MIME_BY_EXTENSION: Record<SupportedLogoExtension, SupportedLogoMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function normalizeExtension(originalName: string): SupportedLogoExtension {
  const extension = path.extname(originalName).slice(1).toLowerCase();
  if (extension === 'jpeg') return 'jpg';
  if (extension === 'png' || extension === 'jpg' || extension === 'webp') {
    return extension;
  }
  throw new ValidationError('El logo debe ser PNG, JPEG o WEBP');
}

function hasPngSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  );
}

function hasJpegSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function hasWebpSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function hasExpectedSignature(
  buffer: Buffer,
  extension: SupportedLogoExtension,
): boolean {
  if (extension === 'png') return hasPngSignature(buffer);
  if (extension === 'jpg') return hasJpegSignature(buffer);
  return hasWebpSignature(buffer);
}

export function validateLogoFile({
  buffer,
  originalName,
  mimeType,
}: Omit<UploadAgencyLogoInput, 'agencyId'>): {
  extension: SupportedLogoExtension;
  mimeType: SupportedLogoMime;
} {
  if (buffer.length === 0) {
    throw new ValidationError('El archivo de logo está vacío');
  }
  if (buffer.length > MAX_LOGO_BYTES) {
    throw new ValidationError('El logo no puede superar 1MB');
  }

  const extension = normalizeExtension(originalName);
  const expectedMime = MIME_BY_EXTENSION[extension];
  if (mimeType !== expectedMime) {
    throw new ValidationError('La extensión y el tipo MIME del logo no coinciden');
  }
  if (!hasExpectedSignature(buffer, extension)) {
    throw new ValidationError('El contenido del archivo de logo no es válido');
  }

  return { extension, mimeType: expectedMime };
}

export class LogoService {
  async uploadAgencyLogo(input: UploadAgencyLogoInput): Promise<string> {
    const file = validateLogoFile(input);
    const objectPath = `${input.agencyId}/logo.${file.extension}`;
    const bucket = supabaseAdmin.storage.from(AGENCY_ASSETS_BUCKET);

    const { error: uploadError } = await bucket.upload(
      objectPath,
      input.buffer,
      {
        contentType: file.mimeType,
        upsert: true,
      },
    );
    if (uploadError) {
      throw new AppError('No se pudo subir el logo', 500, 'STORAGE_UPLOAD_ERROR');
    }

    const obsoletePaths = (Object.keys(MIME_BY_EXTENSION) as SupportedLogoExtension[])
      .filter((extension) => extension !== file.extension)
      .map((extension) => `${input.agencyId}/logo.${extension}`);
    const { error: cleanupError } = await bucket.remove(obsoletePaths);
    if (cleanupError) {
      throw new AppError(
        'El logo se subió, pero no se pudieron limpiar versiones anteriores',
        500,
        'STORAGE_CLEANUP_ERROR',
      );
    }

    const { data } = bucket.getPublicUrl(objectPath);
    if (!data.publicUrl) {
      throw new AppError(
        'No se pudo obtener la URL pública del logo',
        500,
        'STORAGE_PUBLIC_URL_ERROR',
      );
    }

    return `${data.publicUrl}?v=${Date.now()}`;
  }
}

export const logoService = new LogoService();
