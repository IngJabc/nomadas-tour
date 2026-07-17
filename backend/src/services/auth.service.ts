import { supabase, supabaseAdmin } from '../config/database.js';
import { UnauthorizedError, ValidationError } from '../errors/index.js';
import { emailService } from './email.service.js';
import { env } from '../config/env.js';

async function getToken(email: string, password: string): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new UnauthorizedError('Error al obtener la sesión');
  return data.session.access_token;
}

export class AuthService {
  async login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      throw new UnauthorizedError('Correo o contraseña incorrectos');
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (!user) throw new UnauthorizedError('Usuario no encontrado');

    return {
      token: data.session!.access_token,
      user,
    };
  }

  async forgotPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${env.FRONTEND_URL}/reset-password`,
    });

    if (error) throw new ValidationError(error.message);
  }

  async validateInvitation(token: string) {
    const { data: invitation, error } = await supabaseAdmin
      .from('agency_invitations')
      .select('*, agencies(name)')
      .eq('token', token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !invitation) {
      throw new UnauthorizedError('El enlace de invitación no es válido o ha expirado');
    }

    return {
      agency_name: (invitation.agencies as any).name,
      email: invitation.email,
    };
  }

  async acceptInvitation(token: string, password: string) {
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('agency_invitations')
      .select('*, agencies(name)')
      .eq('token', token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (inviteError || !invitation) {
      throw new UnauthorizedError('El enlace de invitación no es válido o ha expirado');
    }

    const email = invitation.email;
    const agencyId = invitation.agency_id;

    let userId: string;

    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existing = existingUsers?.users?.find((u) => u.email === email);

    if (existing) {
      userId = existing.id;

      await supabase.auth.admin.updateUserById(userId, {
        password,
        user_metadata: { role: 'agency', agency_id: agencyId },
        email_confirm: true,
      });
    } else {
      const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: 'agency', agency_id: agencyId },
      });

      if (signUpError) throw new ValidationError(signUpError.message);
      if (!authData.user) throw new ValidationError('Error al crear el usuario');
      userId = authData.user.id;
    }

    const { error: userError } = await supabaseAdmin
      .from('users')
      .upsert(
        { id: userId, email, password_hash: '', role: 'agency', agency_id: agencyId },
        { onConflict: 'id' },
      );

    if (userError) throw new ValidationError(userError.message);

    await supabaseAdmin
      .from('agencies')
      .update({ status: 'active' })
      .eq('id', agencyId);

    await supabaseAdmin
      .from('agency_invitations')
      .update({ used_at: new Date().toISOString(), used_by: userId })
      .eq('id', invitation.id);

    const sessionToken = await getToken(email, password);

    const agencyName = (invitation.agencies as any).name as string;
    emailService.sendRegistrationCompleteEmail(email, agencyName).catch((err) => {
      console.error('[AuthService] Failed to send registration complete email:', err);
    });

    return {
      token: sessionToken,
      user: {
        id: userId,
        email,
        role: 'agency',
        agency_id: agencyId,
      },
    };
  }
}

export const authService = new AuthService();
