import type { NextFunction, Request, Response } from 'express';
import Busboy from 'busboy';
import { z } from 'zod';
import {
  UnauthorizedError,
  ValidationError,
} from '../errors/index.js';
import { agencySettingsService } from '../services/agency-settings.service.js';
import {
  logoService,
  MAX_COVER_BYTES,
  MAX_LOGO_BYTES,
} from '../services/logo.service.js';
import { auditRequestMetadata } from '../utils/audit-metadata.js';

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must use six-digit hex format');

export const updateAgencyBrandingSchema = z
  .object({
    logo_url: z.string().url('Logo URL must be valid').nullable().optional(),
    primary_color: hexColorSchema.optional(),
    secondary_color: hexColorSchema.optional(),
    accent_color: hexColorSchema.optional(),
    // Phase 7 — storefront público: mismos límites que las constraints
    // de la migración 103 (slogan 160 / description 2000).
    cover_url: z.string().url('Cover URL must be valid').nullable().optional(),
    description: z
      .string()
      .trim()
      .max(2000, 'Description must be at most 2000 characters')
      .nullable()
      .optional(),
    slogan: z
      .string()
      .trim()
      .max(160, 'Slogan must be at most 160 characters')
      .nullable()
      .optional(),
  })
  .strict();

function getAccessToken(req: Request): string {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token de acceso requerido');
  }
  return authorization.slice(7);
}

interface ParsedLogoUpload {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}

/** Copy de parseo por activo: el logo conserva literalmente su histórico. */
const PARSE_MESSAGES = {
  logo: {
    onlyFile: 'La solicitud debe contener únicamente el archivo logo',
    noFields: 'No se permiten campos adicionales en la carga del logo',
    onlyOneFile: 'Solo se permite un archivo de logo',
    parseFailed: 'No se pudo procesar el archivo de logo',
    tooLarge: 'El logo no puede superar 1MB',
    missing: 'Selecciona un archivo de logo',
    aborted: 'La carga del logo fue interrumpida',
  },
  cover: {
    onlyFile: 'La solicitud debe contener únicamente el archivo portada',
    noFields: 'No se permiten campos adicionales en la carga de la portada',
    onlyOneFile: 'Solo se permite un archivo de portada',
    parseFailed: 'No se pudo procesar el archivo de portada',
    tooLarge: 'La portada no puede superar 1MB',
    missing: 'Selecciona un archivo de portada',
    aborted: 'La carga de la portada fue interrumpida',
  },
} as const;

type AgencyAssetKind = keyof typeof PARSE_MESSAGES;

function parseAgencyImageUpload(
  req: Request,
  kind: AgencyAssetKind,
): Promise<ParsedLogoUpload> {
  const messages = PARSE_MESSAGES[kind];
  const maxBytes = kind === 'cover' ? MAX_COVER_BYTES : MAX_LOGO_BYTES;
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fields: 0,
          fileSize: maxBytes,
        },
      });
    } catch {
      reject(new ValidationError('Se requiere multipart/form-data válido'));
      return;
    }

    let upload: ParsedLogoUpload | null = null;
    let parserError: ValidationError | null = null;
    const chunks: Buffer[] = [];

    parser.on('file', (fieldName, stream, info) => {
      if (fieldName !== kind || upload) {
        parserError = new ValidationError(messages.onlyFile);
        stream.resume();
        return;
      }

      upload = {
        buffer: Buffer.alloc(0),
        originalName: info.filename,
        mimeType: info.mimeType,
      };
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      stream.on('limit', () => {
        parserError = new ValidationError(messages.tooLarge);
      });
    });

    parser.on('field', () => {
      parserError = new ValidationError(messages.noFields);
    });
    parser.on('fieldsLimit', () => {
      parserError = new ValidationError(messages.noFields);
    });
    parser.on('filesLimit', () => {
      parserError = new ValidationError(messages.onlyOneFile);
    });
    parser.on('error', () => {
      reject(new ValidationError(messages.parseFailed));
    });
    parser.on('close', () => {
      if (parserError) {
        reject(parserError);
        return;
      }
      if (!upload) {
        reject(new ValidationError(messages.missing));
        return;
      }
      resolve({
        ...upload,
        buffer: Buffer.concat(chunks),
      });
    });
    req.on('aborted', () => {
      reject(new ValidationError(messages.aborted));
    });
    req.pipe(parser);
  });
}

export class AgencySettingsController {
  async getBranding(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx?.agencyId;
      if (!agencyId) {
        throw new ValidationError('Agency context required');
      }

      const branding = await agencySettingsService.getBranding(
        agencyId,
        getAccessToken(req),
      );
      res.json(branding);
    } catch (error) {
      next(error);
    }
  }

  async updateBranding(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx?.agencyId;
      if (!agencyId) {
        throw new ValidationError('Agency context required');
      }

      const patch = updateAgencyBrandingSchema.parse(req.body);
      if (Object.keys(patch).length === 0) {
        throw new ValidationError('No branding updates provided');
      }

      const branding = await agencySettingsService.updateBranding(
        agencyId,
        req.ctx!.userId,
        patch,
        auditRequestMetadata(req),
      );

      // Phase 7: al ELIMINAR la portada se borra su objeto del bucket
      // (mejor esfuerzo, nunca lanza) para no dejar huérfanos. La URL ya
      // quedó anulada en base de datos antes de este punto.
      if (patch.cover_url === null) {
        await logoService.removeAgencyCover(agencyId);
      }

      res.json(branding);
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Invalid input', error.issues));
        return;
      }
      next(error);
    }
  }

  async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx?.agencyId;
      if (!agencyId) {
        throw new ValidationError('Agency context required');
      }

      const file = await parseAgencyImageUpload(req, 'logo');
      const logoUrl = await logoService.uploadAgencyLogo({
        agencyId,
        ...file,
      });
      const branding = await agencySettingsService.updateBranding(
        agencyId,
        req.ctx!.userId,
        { logo_url: logoUrl },
        auditRequestMetadata(req),
      );

      res.json(branding);
    } catch (error) {
      next(error);
    }
  }

  /** Phase 7: portada del storefront público (mismo patrón que el logo). */
  async uploadCover(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx?.agencyId;
      if (!agencyId) {
        throw new ValidationError('Agency context required');
      }

      const file = await parseAgencyImageUpload(req, 'cover');
      const coverUrl = await logoService.uploadAgencyCover({
        agencyId,
        ...file,
      });
      const branding = await agencySettingsService.updateBranding(
        agencyId,
        req.ctx!.userId,
        { cover_url: coverUrl },
        auditRequestMetadata(req),
      );

      res.json(branding);
    } catch (error) {
      next(error);
    }
  }
}

export const agencySettingsController = new AgencySettingsController();
