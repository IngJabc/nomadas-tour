import path from 'node:path';
import { supabaseAdmin } from '../config/database.js';
import { AppError, ValidationError } from '../errors/index.js';

export const AGENCY_ASSETS_BUCKET = 'agency-assets';
export const MAX_LOGO_BYTES = 1024 * 1024;
// El bucket (042) limita TODOS los archivos a 1MB: la portada usa el
// mismo techo que el logo para no depender de un bucket nuevo.
export const MAX_COVER_BYTES = MAX_LOGO_BYTES;

type SupportedLogoExtension = 'png' | 'jpg' | 'webp';
type SupportedLogoMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Phase 7: mismo bucket y misma validación, distinto objeto por agencia. */
type AgencyAssetKind = 'logo' | 'cover';

interface UploadAgencyAssetInput {
  agencyId: string;
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}

interface AssetMessages {
  unsupportedExtension: string;
  empty: string;
  tooLarge: string;
  extensionMismatch: string;
  invalidContent: string;
  uploadFailed: string;
  cleanupFailed: string;
  publicUrlFailed: string;
}

/** Mensajes por activo: el logo conserva literalmente su copy histórico. */
const MESSAGES: Record<AgencyAssetKind, AssetMessages> = {
  logo: {
    unsupportedExtension: 'El logo debe ser PNG, JPEG o WEBP',
    empty: 'El archivo de logo está vacío',
    tooLarge: 'El logo no puede superar 1MB',
    extensionMismatch: 'La extensión y el tipo MIME del logo no coinciden',
    invalidContent: 'El contenido del archivo de logo no es válido',
    uploadFailed: 'No se pudo subir el logo',
    cleanupFailed:
      'El logo se subió, pero no se pudieron limpiar versiones anteriores',
    publicUrlFailed: 'No se pudo obtener la URL pública del logo',
  },
  cover: {
    unsupportedExtension: 'La portada debe ser PNG, JPEG o WEBP',
    empty: 'El archivo de portada está vacío',
    tooLarge: 'La portada no puede superar 1MB',
    extensionMismatch: 'La extensión y el tipo MIME de la portada no coinciden',
    invalidContent: 'El contenido del archivo de portada no es válido',
    uploadFailed: 'No se pudo subir la portada',
    cleanupFailed:
      'La portada se subió, pero no se pudieron limpiar versiones anteriores',
    publicUrlFailed: 'No se pudo obtener la URL pública de la portada',
  },
};

const MIME_BY_EXTENSION: Record<SupportedLogoExtension, SupportedLogoMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function normalizeExtension(
  originalName: string,
  messages: AssetMessages,
): SupportedLogoExtension {
  const extension = path.extname(originalName).slice(1).toLowerCase();
  if (extension === 'jpeg') return 'jpg';
  if (extension === 'png' || extension === 'jpg' || extension === 'webp') {
    return extension;
  }
  throw new ValidationError(messages.unsupportedExtension);
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

export function validateAgencyAssetFile(
  input: Omit<UploadAgencyAssetInput, 'agencyId'>,
  kind: AgencyAssetKind,
): {
  extension: SupportedLogoExtension;
  mimeType: SupportedLogoMime;
} {
  const messages = MESSAGES[kind];
  const { buffer, originalName, mimeType } = input;
  if (buffer.length === 0) {
    throw new ValidationError(messages.empty);
  }
  if (buffer.length > (kind === 'cover' ? MAX_COVER_BYTES : MAX_LOGO_BYTES)) {
    throw new ValidationError(messages.tooLarge);
  }

  const extension = normalizeExtension(originalName, messages);
  const expectedMime = MIME_BY_EXTENSION[extension];
  if (mimeType !== expectedMime) {
    throw new ValidationError(messages.extensionMismatch);
  }
  if (!hasExpectedSignature(buffer, extension)) {
    throw new ValidationError(messages.invalidContent);
  }

  return { extension, mimeType: expectedMime };
}

/** Validación histórica del logo: firma pública estable para sus tests. */
export function validateLogoFile(
  input: Omit<UploadAgencyAssetInput, 'agencyId'>,
): {
  extension: SupportedLogoExtension;
  mimeType: SupportedLogoMime;
} {
  return validateAgencyAssetFile(input, 'logo');
}

export class LogoService {
  async uploadAgencyLogo(input: UploadAgencyAssetInput): Promise<string> {
    return this.uploadAgencyAsset(input, 'logo');
  }

  /** Phase 7: portada del storefront — mismo bucket, objeto `{agencyId}/cover.*`. */
  async uploadAgencyCover(input: UploadAgencyAssetInput): Promise<string> {
    return this.uploadAgencyAsset(input, 'cover');
  }

  /**
   * Borra el objeto de portada de la agencia (mejor esfuerzo): se llama
   * cuando la agencia ELIMINA la portada para no dejar huérfanos en el
   * bucket. Nunca lanza: la URL ya quedó anulada en base de datos.
   */
  async removeAgencyCover(agencyId: string): Promise<void> {
    const paths = (Object.keys(MIME_BY_EXTENSION) as SupportedLogoExtension[])
      .map((extension) => `${agencyId}/cover.${extension}`);
    try {
      const bucket = supabaseAdmin.storage.from(AGENCY_ASSETS_BUCKET);
      await bucket.remove(paths);
    } catch {
      // Mejor esfuerzo: un archivo huérfano no rompe la operación.
    }
  }

  private async uploadAgencyAsset(
    input: UploadAgencyAssetInput,
    kind: AgencyAssetKind,
  ): Promise<string> {
    const messages = MESSAGES[kind];
    const file = validateAgencyAssetFile(input, kind);
    const objectPath = `${input.agencyId}/${kind}.${file.extension}`;
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
      throw new AppError(messages.uploadFailed, 500, 'STORAGE_UPLOAD_ERROR');
    }

    const obsoletePaths = (Object.keys(MIME_BY_EXTENSION) as SupportedLogoExtension[])
      .filter((extension) => extension !== file.extension)
      .map((extension) => `${input.agencyId}/${kind}.${extension}`);
    const { error: cleanupError } = await bucket.remove(obsoletePaths);
    if (cleanupError) {
      throw new AppError(
        messages.cleanupFailed,
        500,
        'STORAGE_CLEANUP_ERROR',
      );
    }

    const { data } = bucket.getPublicUrl(objectPath);
    if (!data.publicUrl) {
      throw new AppError(
        messages.publicUrlFailed,
        500,
        'STORAGE_PUBLIC_URL_ERROR',
      );
    }

    return `${data.publicUrl}?v=${Date.now()}`;
  }
}

export const logoService = new LogoService();
