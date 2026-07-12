import { supabase, supabaseAdmin } from '../config/database.js';
import { UnauthorizedError, ValidationError } from '../errors/index.js';
async function getToken(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session)
        throw new UnauthorizedError('Failed to obtain session');
    return data.session.access_token;
}
export class AuthService {
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error || !data.user) {
            throw new UnauthorizedError('Invalid email or password');
        }
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', data.user.id)
            .single();
        if (!user)
            throw new UnauthorizedError('User not found');
        return {
            token: data.session.access_token,
            user,
        };
    }
    async validateInvitation(token) {
        const { data: invitation, error } = await supabaseAdmin
            .from('agency_invitations')
            .select('*, agencies(name)')
            .eq('token', token)
            .is('used_at', null)
            .gt('expires_at', new Date().toISOString())
            .single();
        if (error || !invitation) {
            throw new UnauthorizedError('Invalid or expired invitation token');
        }
        return {
            agency_name: invitation.agencies.name,
            email: invitation.email,
        };
    }
    async acceptInvitation(token, password) {
        const { data: invitation, error: inviteError } = await supabaseAdmin
            .from('agency_invitations')
            .select('*, agencies(name)')
            .eq('token', token)
            .is('used_at', null)
            .gt('expires_at', new Date().toISOString())
            .single();
        if (inviteError || !invitation) {
            throw new UnauthorizedError('Invalid or expired invitation token');
        }
        const email = invitation.email;
        const agencyId = invitation.agency_id;
        const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { role: 'agency' },
        });
        if (signUpError)
            throw new ValidationError(signUpError.message);
        if (!authData.user)
            throw new ValidationError('Failed to create user');
        const { error: userError } = await supabaseAdmin.from('users').insert({
            id: authData.user.id,
            email,
            password_hash: '',
            role: 'agency',
            agency_id: agencyId,
        });
        if (userError)
            throw new ValidationError(userError.message);
        await supabaseAdmin
            .from('agencies')
            .update({ status: 'active' })
            .eq('id', agencyId);
        await supabaseAdmin
            .from('agency_invitations')
            .update({ used_at: new Date().toISOString(), used_by: authData.user.id })
            .eq('id', invitation.id);
        await supabase.auth.admin.updateUserById(authData.user.id, {
            user_metadata: { role: 'agency', agency_id: agencyId },
        });
        const sessionToken = await getToken(email, password);
        return {
            token: sessionToken,
            user: {
                id: authData.user.id,
                email,
                role: 'agency',
                agency_id: agencyId,
            },
        };
    }
}
export const authService = new AuthService();
//# sourceMappingURL=auth.service.js.map