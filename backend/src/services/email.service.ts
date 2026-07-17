import { render } from '@react-email/render';
import { resend, EMAIL_CONFIG } from '../config/email.js';
import { InvitationEmail } from '../templates/invitation-email.js';
import { RegistrationCompleteEmail } from '../templates/registration-complete-email.js';
import { ResetPasswordEmail } from '../templates/reset-password-email.js';
import { NewTripAssignedEmail } from '../templates/new-trip-assigned-email.js';
import { TripPostponedEmail } from '../templates/trip-postponed-email.js';
import { TripCancelledEmail } from '../templates/trip-cancelled-email.js';

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

  async sendNewTripAssignedEmail(
    to: string,
    agencyName: string,
    origin: string,
    destination: string,
    departureTime: string,
    vehicleType: string,
    capacity: number,
    tripId: string,
    agencyId: string,
  ) {
    const tripLink = `${EMAIL_CONFIG.frontendUrl}/agency/trips?agency=${agencyId}`;

    const html = await render(
      NewTripAssignedEmail({ agencyName, origin, destination, departureTime, vehicleType, capacity, tripLink })
    );

    const { error } = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to,
      subject: 'Nuevo viaje asignado — Nómadas Tour',
      html,
    });

    if (error) {
      console.error('[EmailService] Failed to send new trip assigned email:', error);
      throw new Error('Failed to send new trip assigned email');
    }
  }

  async sendTripPostponedEmail(
    to: string,
    agencyName: string,
    origin: string,
    destination: string,
    oldDepartureTime: string,
    newDepartureTime: string,
    tripId: string,
    agencyId: string,
  ) {
    const tripLink = `${EMAIL_CONFIG.frontendUrl}/agency/trips?agency=${agencyId}`;

    const html = await render(
      TripPostponedEmail({ agencyName, origin, destination, oldDepartureTime, newDepartureTime, tripLink })
    );

    const { error } = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to,
      subject: 'Viaje reprogramado — Nómadas Tour',
      html,
    });

    if (error) {
      console.error('[EmailService] Failed to send trip postponed email:', error);
      throw new Error('Failed to send trip postponed email');
    }
  }

  async sendTripCancelledEmail(
    to: string,
    agencyName: string,
    origin: string,
    destination: string,
    departureTime: string,
    tripId: string,
  ) {
    const html = await render(
      TripCancelledEmail({ agencyName, origin, destination, departureTime })
    );

    const { error } = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to,
      subject: 'Viaje cancelado — Nómadas Tour',
      html,
    });

    if (error) {
      console.error('[EmailService] Failed to send trip cancelled email:', error);
      throw new Error('Failed to send trip cancelled email');
    }
  }
}

export const emailService = new EmailService();
