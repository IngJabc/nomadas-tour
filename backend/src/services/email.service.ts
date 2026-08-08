import { render } from '@react-email/render';
import { resend, EMAIL_CONFIG } from '../config/email.js';
import { InvitationEmail } from '../templates/invitation-email.js';
import { RegistrationCompleteEmail } from '../templates/registration-complete-email.js';
import { ResetPasswordEmail } from '../templates/reset-password-email.js';
import { NewTripAssignedEmail } from '../templates/new-trip-assigned-email.js';
import { TripPostponedEmail } from '../templates/trip-postponed-email.js';
import { TripCancelledEmail } from '../templates/trip-cancelled-email.js';
import { ReservationConfirmedEmail } from '../templates/reservation-confirmed-email.js';
import { generateTicketPNG } from '../utils/ticket-png.js';
import type { TicketData } from '../types/reservation.js';
import { evaluateDelivery } from './email-delivery-policy.js';

/** OPS-EMAIL-001 — result of a delivery attempt (send or policy skip). */
export type EmailSendResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: 'restricted' | 'disabled' };

type EmailPayload = {
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
};

export class EmailService {
  /**
   * Unique delivery gate: policy check → optional build → Resend.
   * No other method should call resend.emails.send.
   */
  private async deliver(
    to: string,
    kind: string,
    failMessage: string,
    build: () => Promise<EmailPayload>,
  ): Promise<EmailSendResult> {
    const decision = evaluateDelivery(to, {
      mode: EMAIL_CONFIG.deliveryMode,
      allowedRecipients: EMAIL_CONFIG.allowedRecipients,
    });

    if (decision.action === 'skip') {
      console.log(
        JSON.stringify({
          event: 'EMAIL_SKIPPED',
          mode: EMAIL_CONFIG.deliveryMode,
          reason: decision.reason,
          kind,
          to_domain: to.includes('@')
            ? to.trim().toLowerCase().split('@')[1]
            : 'unknown',
        }),
      );
      return { status: 'skipped', reason: decision.reason };
    }

    const payload = await build();
    const { error } = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to,
      subject: payload.subject,
      html: payload.html,
      ...(payload.attachments ? { attachments: payload.attachments } : {}),
    });

    if (error) {
      console.error(`[EmailService] ${failMessage}:`, error);
      throw new Error(failMessage);
    }

    return { status: 'sent' };
  }

  async sendInvitationEmail(
    to: string,
    agencyName: string,
    invitationLink: string,
  ): Promise<EmailSendResult> {
    return this.deliver(
      to,
      'invitation',
      'Failed to send invitation email',
      async () => {
        const fullLink = `${EMAIL_CONFIG.frontendUrl}/accept-invitation?token=${invitationLink}`;
        const html = await render(
          InvitationEmail({ agencyName, invitationLink: fullLink }),
        );
        return { subject: 'Invitación a Nómadas Tour', html };
      },
    );
  }

  async sendRegistrationCompleteEmail(
    to: string,
    agencyName: string,
  ): Promise<EmailSendResult> {
    return this.deliver(
      to,
      'registration_complete',
      'Failed to send registration complete email',
      async () => {
        const loginUrl = `${EMAIL_CONFIG.frontendUrl}/login`;
        const html = await render(
          RegistrationCompleteEmail({ agencyName, email: to, loginUrl }),
        );
        return { subject: 'Registro completado — Nómadas Tour', html };
      },
    );
  }

  async sendResetPasswordEmail(
    to: string,
    code: string,
    token: string,
  ): Promise<EmailSendResult> {
    return this.deliver(
      to,
      'reset_password',
      'Failed to send reset password email',
      async () => {
        const resetUrl = `${EMAIL_CONFIG.frontendUrl}/reset-password?token=${token}`;
        const html = await render(ResetPasswordEmail({ code, resetUrl }));
        return { subject: 'Recuperar contraseña — Nómadas Tour', html };
      },
    );
  }

  async sendNewTripAssignedEmail(
    to: string,
    agencyName: string,
    origin: string,
    destination: string,
    departureTime: string,
    vehicleType: string,
    capacity: number,
    _tripId: string,
    agencyId: string,
  ): Promise<EmailSendResult> {
    return this.deliver(
      to,
      'new_trip_assigned',
      'Failed to send new trip assigned email',
      async () => {
        const tripLink = `${EMAIL_CONFIG.frontendUrl}/agency/trips?agency=${agencyId}`;
        const html = await render(
          NewTripAssignedEmail({
            agencyName,
            origin,
            destination,
            departureTime,
            vehicleType,
            capacity,
            tripLink,
          }),
        );
        return { subject: 'Nuevo viaje asignado — Nómadas Tour', html };
      },
    );
  }

  async sendTripPostponedEmail(
    to: string,
    agencyName: string,
    origin: string,
    destination: string,
    oldDepartureTime: string,
    newDepartureTime: string,
    _tripId: string,
    agencyId: string,
  ): Promise<EmailSendResult> {
    return this.deliver(
      to,
      'trip_postponed',
      'Failed to send trip postponed email',
      async () => {
        const tripLink = `${EMAIL_CONFIG.frontendUrl}/agency/trips?agency=${agencyId}`;
        const html = await render(
          TripPostponedEmail({
            agencyName,
            origin,
            destination,
            oldDepartureTime,
            newDepartureTime,
            tripLink,
          }),
        );
        return { subject: 'Viaje reprogramado — Nómadas Tour', html };
      },
    );
  }

  async sendTripCancelledEmail(
    to: string,
    agencyName: string,
    origin: string,
    destination: string,
    departureTime: string,
    _tripId: string,
  ): Promise<EmailSendResult> {
    return this.deliver(
      to,
      'trip_cancelled',
      'Failed to send trip cancelled email',
      async () => {
        const html = await render(
          TripCancelledEmail({ agencyName, origin, destination, departureTime }),
        );
        return { subject: 'Viaje cancelado — Nómadas Tour', html };
      },
    );
  }

  async sendReservationConfirmationEmail(
    to: string,
    ticket: TicketData,
  ): Promise<EmailSendResult> {
    return this.deliver(
      to,
      'reservation_confirmation',
      'Failed to send reservation confirmation email',
      async () => {
        const origin = ticket.trip?.origin ?? '';
        const destination = ticket.trip?.destination ?? '';
        const html = await render(ReservationConfirmedEmail({ ticket }));

        let attachments: { filename: string; content: Buffer }[] | undefined;
        try {
          const pngBuffer = await generateTicketPNG(ticket);
          const dest = ticket.trip?.destination ?? 'Destino';
          const date = new Date(
            ticket.trip?.departure_time ?? ticket.created_at,
          );
          const dateStr = date.toLocaleDateString('es-VE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });
          const booker = ticket.booker_name ?? 'Pasajero';
          const filename = `${dest} - ${dateStr} - ${booker}.png`;
          attachments = [{ filename, content: pngBuffer }];
        } catch (err) {
          console.error(
            JSON.stringify({
              event: 'TICKET_PNG_FAILED',
              reservation_id: ticket.reservation_id,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }

        return {
          subject: `Reserva confirmada — ${origin} → ${destination} — Nómadas Tour`,
          html,
          attachments,
        };
      },
    );
  }
}

export const emailService = new EmailService();
