'use client';

import { PassengerData } from '@/types';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Mail } from 'lucide-react';

const LETTER_RE = /[^a-zA-ZáéíóúñüÁÉÍÓÚÑÜ\s\-']/g;
const PHONE_RE = /[^\d+]/g;

function filterName(v: string): string {
  return v.replace(LETTER_RE, '');
}

function filterDigits(v: string): string {
  return v.replace(/\D/g, '');
}

function filterPhone(v: string): string {
  const clean = v.replace(PHONE_RE, '');
  const plusIndex = clean.indexOf('+');
  if (plusIndex > 0) return '+' + clean.replace(/\+/g, '').slice(0, 12);
  return clean.replace(/(?<=.)\+/g, '').slice(0, 13);
}

interface PassengerFormProps {
  passengers: PassengerData[];
  onUpdate: (seatId: string, field: keyof PassengerData, value: string) => void;
  onNext: () => void;
  errors: Record<string, string>;
  bookerName: string;
  bookerDocument: string;
  onBookerNameChange: (v: string) => void;
  onBookerDocumentChange: (v: string) => void;
  bookerErrors: { name?: string; document?: string; email?: string };
  contactEmail: string;
  onContactEmailChange: (v: string) => void;
  sendTicketEmail: boolean;
  onSendTicketEmailChange: (v: boolean) => void;
}

export function PassengerForm({
  passengers,
  onUpdate,
  onNext,
  errors,
  bookerName,
  bookerDocument,
  onBookerNameChange,
  onBookerDocumentChange,
  bookerErrors,
  contactEmail,
  onContactEmailChange,
  sendTicketEmail,
  onSendTicketEmailChange,
}: PassengerFormProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="border-l-4 border-[var(--color-brand-cyan)] pl-3">
          <h3 className="font-[family-name:var(--font-heading)] text-base font-bold text-[var(--color-brand-navy)]">
            Datos del Reservante
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Nombre"
            placeholder="Nombre completo"
            value={bookerName}
            onChange={(e) => onBookerNameChange(filterName(e.target.value))}
            error={bookerErrors.name}
            autoComplete="name"
            enterKeyHint="next"
          />
          <Input
            label="Documento"
            placeholder="8 dígitos"
            value={bookerDocument}
            onChange={(e) => onBookerDocumentChange(filterDigits(e.target.value))}
            error={bookerErrors.document}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={8}
          />
        </div>

        <div className="bg-white border border-[rgba(0,0,0,0.06)] rounded-2xl p-4">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div className="relative">
              <input
                type="checkbox"
                checked={sendTicketEmail}
                onChange={(e) => {
                  onSendTicketEmailChange(e.target.checked);
                  if (!e.target.checked) {
                    onContactEmailChange('');
                  }
                }}
                className="sr-only peer"
              />
              <div className="w-5 h-5 rounded border-2 border-[#d1d5db] bg-white peer-checked:bg-[var(--color-brand-cyan)] peer-checked:border-[var(--color-brand-cyan)] transition-colors duration-150 flex items-center justify-center">
                {sendTicketEmail && (
                  <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </div>
            <span className="font-[family-name:var(--font-body)] text-sm font-medium text-[var(--color-brand-navy)]">
              Enviar boleto por correo electrónico
            </span>
          </label>

          {sendTicketEmail && (
            <div className="mt-3">
              <Input
                label="Correo electrónico del reservante"
                placeholder="correo@ejemplo.com"
                value={contactEmail}
                onChange={(e) => onContactEmailChange(e.target.value)}
                error={bookerErrors.email}
                type="email"
                inputMode="email"
                autoComplete="email"
                leftIcon={<Mail className="w-4 h-4" />}
              />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="border-l-4 border-[var(--color-brand-cyan)] pl-3">
          <h3 className="font-[family-name:var(--font-heading)] text-base font-bold text-[var(--color-brand-navy)]">
            Datos de Pasajeros ({passengers.length})
          </h3>
        </div>

        <div className="space-y-3">
          {passengers.map((passenger, i) => (
            <div
              key={passenger.seat_id}
              className="bg-white border border-[rgba(0,0,0,0.06)] rounded-2xl p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-brand-cyan)] text-white flex items-center justify-center text-xs font-bold font-[family-name:var(--font-body)]">
                  {passenger.seat_code}
                </div>
                <span className="font-[family-name:var(--font-body)] text-sm font-semibold text-[var(--color-brand-navy)]">
                  Asiento {passenger.seat_code}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  label="Nombre"
                  placeholder="Nombre completo"
                  value={passenger.name}
                  onChange={(e) => onUpdate(passenger.seat_id, 'name', filterName(e.target.value))}
                  error={errors[`${passenger.seat_id}_name`]}
                  autoComplete="name"
                  enterKeyHint="next"
                />
                <Input
                  label="Documento"
                  placeholder="8 dígitos"
                  value={passenger.document}
                  onChange={(e) => onUpdate(passenger.seat_id, 'document', filterDigits(e.target.value))}
                  error={errors[`${passenger.seat_id}_document`]}
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="next"
                  maxLength={8}
                />
                <Input
                  label="Teléfono"
                  placeholder="04xx-xxxxxxx"
                  value={passenger.phone || ''}
                  onChange={(e) => onUpdate(passenger.seat_id, 'phone', filterPhone(e.target.value))}
                  error={errors[`${passenger.seat_id}_phone`]}
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint={i === passengers.length - 1 ? 'done' : 'next'}
                  maxLength={13}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="primary" onClick={onNext}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
