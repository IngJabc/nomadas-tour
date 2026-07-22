'use client';

import { PassengerData } from '@/types';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

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
  bookerErrors: { name?: string; document?: string };
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
