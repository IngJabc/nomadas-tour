import { createAuthenticatedClient } from '../config/database.js';
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
    accessToken: string,
    patch: AgencyBrandingPatch,
  ): Promise<AgencyBrandingSettings> {
    const client = createAuthenticatedClient(accessToken);
    const { data, error } = await client
      .from('agency_settings')
      .update(patch)
      .eq('agency_id', agencyId)
      .select(BRANDING_COLUMNS)
      .single();

    if (error) {
      throw new ValidationError(error.message);
    }
    if (!data) {
      throw new NotFoundError('Configuración de marca no encontrada');
    }

    return data as AgencyBrandingSettings;
  }
}

export const agencySettingsService = new AgencySettingsService();
