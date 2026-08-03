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
  MAX_LOGO_BYTES,
} from '../services/logo.service.js';

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must use six-digit hex format');

export const updateAgencyBrandingSchema = z
  .object({
    logo_url: z.string().url('Logo URL must be valid').nullable().optional(),
    primary_color: hexColorSchema.optional(),
    secondary_color: hexColorSchema.optional(),
    accent_color: hexColorSchema.optional(),
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

function parseLogoUpload(req: Request): Promise<ParsedLogoUpload> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fields: 0,
          fileSize: MAX_LOGO_BYTES,
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
      if (fieldName !== 'logo' || upload) {
        parserError = new ValidationError(
          'La solicitud debe contener únicamente el archivo logo',
        );
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
        parserError = new ValidationError('El logo no puede superar 1MB');
      });
    });

    parser.on('field', () => {
      parserError = new ValidationError(
        'No se permiten campos adicionales en la carga del logo',
      );
    });
    parser.on('fieldsLimit', () => {
      parserError = new ValidationError(
        'No se permiten campos adicionales en la carga del logo',
      );
    });
    parser.on('filesLimit', () => {
      parserError = new ValidationError('Solo se permite un archivo de logo');
    });
    parser.on('error', () => {
      reject(new ValidationError('No se pudo procesar el archivo de logo'));
    });
    parser.on('close', () => {
      if (parserError) {
        reject(parserError);
        return;
      }
      if (!upload) {
        reject(new ValidationError('Selecciona un archivo de logo'));
        return;
      }
      resolve({
        ...upload,
        buffer: Buffer.concat(chunks),
      });
    });
    req.on('aborted', () => {
      reject(new ValidationError('La carga del logo fue interrumpida'));
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
        getAccessToken(req),
        patch,
      );
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

      const file = await parseLogoUpload(req);
      const logoUrl = await logoService.uploadAgencyLogo({
        agencyId,
        ...file,
      });
      const branding = await agencySettingsService.updateBranding(
        agencyId,
        getAccessToken(req),
        { logo_url: logoUrl },
      );

      res.json(branding);
    } catch (error) {
      next(error);
    }
  }
}

export const agencySettingsController = new AgencySettingsController();
