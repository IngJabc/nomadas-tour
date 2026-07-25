-- Add contact_email, send_ticket_email, and ticket_email_sent_at to reservations
-- to support automatic ticket email delivery after reservation creation.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS contact_email TEXT NULL,
  ADD COLUMN IF NOT EXISTS send_ticket_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_email_sent_at TIMESTAMPTZ NULL;
