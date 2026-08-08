import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.hoisted(() => vi.fn());
const emailConfig = vi.hoisted(() => ({
  from: 'Nómadas Tours <onboarding@resend.dev>',
  frontendUrl: 'http://localhost:3000',
  deliveryMode: 'normal' as 'normal' | 'restricted' | 'disabled',
  allowedRecipients: [] as string[],
}));

vi.mock('../config/email.js', () => ({
  resend: {
    emails: {
      send: sendMock,
    },
  },
  EMAIL_CONFIG: emailConfig,
}));

vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<html>ok</html>'),
}));

vi.mock('../utils/ticket-png.js', () => ({
  generateTicketPNG: vi.fn(async () => Buffer.from('png')),
}));

vi.mock('../templates/invitation-email.js', () => ({
  InvitationEmail: vi.fn(() => null),
}));
vi.mock('../templates/registration-complete-email.js', () => ({
  RegistrationCompleteEmail: vi.fn(() => null),
}));
vi.mock('../templates/reset-password-email.js', () => ({
  ResetPasswordEmail: vi.fn(() => null),
}));
vi.mock('../templates/new-trip-assigned-email.js', () => ({
  NewTripAssignedEmail: vi.fn(() => null),
}));
vi.mock('../templates/trip-postponed-email.js', () => ({
  TripPostponedEmail: vi.fn(() => null),
}));
vi.mock('../templates/trip-cancelled-email.js', () => ({
  TripCancelledEmail: vi.fn(() => null),
}));
vi.mock('../templates/reservation-confirmed-email.js', () => ({
  ReservationConfirmedEmail: vi.fn(() => null),
}));

import { EmailService } from './email.service.js';

describe('OPS-EMAIL-001 — EmailService delivery gate', () => {
  const service = new EmailService();

  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    emailConfig.deliveryMode = 'normal';
    emailConfig.allowedRecipients = [];
  });

  it('normal → calls Resend', async () => {
    const result = await service.sendInvitationEmail(
      'agency@example.com',
      'Agencia',
      'tok',
    );
    expect(result).toEqual({ status: 'sent' });
    expect(sendMock).toHaveBeenCalledOnce();
    expect(sendMock.mock.calls[0][0].to).toBe('agency@example.com');
  });

  it('restricted + allowed → calls Resend', async () => {
    emailConfig.deliveryMode = 'restricted';
    emailConfig.allowedRecipients = ['agency@example.com'];

    const result = await service.sendInvitationEmail(
      'Agency@Example.com',
      'Agencia',
      'tok',
    );
    expect(result).toEqual({ status: 'sent' });
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it('restricted + blocked → does not call Resend', async () => {
    emailConfig.deliveryMode = 'restricted';
    emailConfig.allowedRecipients = ['allowed@example.com'];

    const result = await service.sendInvitationEmail(
      'blocked@example.com',
      'Agencia',
      'tok',
    );
    expect(result).toEqual({ status: 'skipped', reason: 'restricted' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('restricted + empty allowlist → does not call Resend', async () => {
    emailConfig.deliveryMode = 'restricted';
    emailConfig.allowedRecipients = [];

    const result = await service.sendResetPasswordEmail(
      'anyone@example.com',
      '123456',
      'tok',
    );
    expect(result).toEqual({ status: 'skipped', reason: 'restricted' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('disabled → does not call Resend', async () => {
    emailConfig.deliveryMode = 'disabled';
    emailConfig.allowedRecipients = ['anyone@example.com'];

    const result = await service.sendRegistrationCompleteEmail(
      'anyone@example.com',
      'Agencia',
    );
    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('Resend error in normal → throws', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'validation_error', name: 'validation_error' },
    });

    await expect(
      service.sendInvitationEmail('agency@example.com', 'Agencia', 'tok'),
    ).rejects.toThrow('Failed to send invitation email');
    expect(sendMock).toHaveBeenCalledOnce();
  });
});
