import { render } from '@react-email/render';
import { resend, EMAIL_CONFIG } from '../config/email.js';
import { InvitationEmail } from '../templates/invitation-email.js';
import { RegistrationCompleteEmail } from '../templates/registration-complete-email.js';
import { ResetPasswordEmail } from '../templates/reset-password-email.js';

export class EmailService {
  async sendInvitationEmail(to: string, agencyName: string, invitationLink: string) {
    const fullLink = `${EMAIL_CONFIG.frontendUrl}/accept-invitation?token=${invitationLink}`;

    const html = await render(
      InvitationEmail({ agencyName, invitationLink: fullLink })
    );

    const { error } = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to,
      subject: 'Invitación a Nómadas Tour',
      html,
    });

    if (error) {
      console.error('[EmailService] Failed to send invitation email:', error);
      throw new Error('Failed to send invitation email');
    }
  }

  async sendRegistrationCompleteEmail(to: string, agencyName: string) {
    const loginUrl = `${EMAIL_CONFIG.frontendUrl}/login`;

    const html = await render(
      RegistrationCompleteEmail({ agencyName, email: to, loginUrl })
    );

    const { error } = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to,
      subject: 'Registro completado — Nómadas Tour',
      html,
    });

    if (error) {
      console.error('[EmailService] Failed to send registration complete email:', error);
      throw new Error('Failed to send registration complete email');
    }
  }

  async sendResetPasswordEmail(to: string, code: string, token: string) {
    const resetUrl = `${EMAIL_CONFIG.frontendUrl}/reset-password?token=${token}`;

    const html = await render(
      ResetPasswordEmail({ code, resetUrl })
    );

    const { error } = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to,
      subject: 'Recuperar contraseña — Nómadas Tour',
      html,
    });

    if (error) {
      console.error('[EmailService] Failed to send reset password email:', error);
      throw new Error('Failed to send reset password email');
    }
  }
}

export const emailService = new EmailService();
