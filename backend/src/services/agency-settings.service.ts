import { createAuthenticatedClient, supabaseAdmin } from '../config/database.js';
import { NotFoundError, ValidationError } from '../errors/index.js';

const BRANDING_COLUMNS =
  'logo_url, primary_color, secondary_color, accent_color';

export interface AgencyBrandingSettings {
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
}

export type AgencyBrandingPatch = Partial<AgencyBrandingSettings>;

export class AgencySettingsService {
  async getBranding(
    agencyId: string,
    accessToken: string,
  ): Promise<AgencyBrandingSettings> {
    const client = createAuthenticatedClient(accessToken);
    const { data, error } = await client
      .from('agency_settings')
      .select(BRANDING_COLUMNS)
      .eq('agency_id', agencyId)
      .single();

    if (error || !data) {
      throw new NotFoundError('Configuración de marca no encontrada');
    }

    return data as AgencyBrandingSettings;
  }

  async updateBranding(
    agencyId: string,
    actorUserId: string,
    patch: AgencyBrandingPatch,
    metadata: Record<string, unknown> = { source: 'api' },
  ): Promise<AgencyBrandingSettings> {
    const { data, error } = await supabaseAdmin.rpc('update_agency_branding', {
      p_agency_id: agencyId,
      p_actor_user_id: actorUserId,
      p_patch: patch,
      p_metadata: metadata,
    });

    if (error) {
      const raw = error.message ?? '';
      if (raw.includes('ERR_SETTINGS_NOT_FOUND')) {
        throw new NotFoundError('Configuración de marca no encontrada');
      }
      if (
        raw.includes('ERR_ACTOR_NOT_FOUND') ||
        raw.includes('ERR_ACTOR_AGENCY_MISMATCH')
      ) {
        throw new ValidationError(
          raw.includes(': ') ? raw.slice(raw.indexOf(': ') + 2) : raw,
        );
      }
      throw new ValidationError(raw);
    }

    if (!data) {
      throw new NotFoundError('Configuración de marca no encontrada');
    }

    return {
      logo_url: data.logo_url ?? null,
      primary_color: data.primary_color,
      secondary_color: data.secondary_color,
      accent_color: data.accent_color,
    };
  }
}

export const agencySettingsService = new AgencySettingsService();
