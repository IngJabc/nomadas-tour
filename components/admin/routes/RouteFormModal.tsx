'use client';

import { useState, useEffect, useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { RouteData } from './RouteCard';

const DEFAULT_ORIGIN = 'Barquisimeto';

interface RouteFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  route?: RouteData | null;
  onClose: () => void;
  onSubmit: (data: { origin: string; destination: string }) => Promise<void>;
}

export function RouteFormModal({ open, mode, route, onClose, onSubmit }: RouteFormModalProps) {
  const instanceId = useId();
  const titleId = `route-form-title-${instanceId}`;

  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const [fieldError, setFieldError] = useState('');

  const isEdit = mode === 'edit';
  const hasTripsButNoReservations = isEdit && route && route.tripCount > 0 && route.reservationCount === 0;

  useEffect(() => {
    if (open) {
      if (isEdit && route) {
        setDestination(route.destination);
      } else {
        setDestination('');
      }
      setLoading(false);
      setFeedback(null);
      setFieldError('');
    }
  }, [open, isEdit, route]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError('');

    if (!destination.trim() || destination.trim().length < 2) {
      setFieldError('El destino debe tener al menos 2 caracteres.');
      return;
    }

    setLoading(true);
    try {
      await onSubmit({ origin: DEFAULT_ORIGIN, destination: destination.trim() });
      setFeedback('success');
      setTimeout(() => onClose(), 600);
    } catch {
      setFeedback('error');
      setTimeout(() => setFeedback(null), 1500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" titleId={titleId}>
      <ModalHeader>
        <h2 id={titleId} className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)]">
          {isEdit ? 'Editar ruta' : 'Nueva ruta'}
        </h2>
      </ModalHeader>

      <ModalBody>
        {hasTripsButNoReservations && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-[#fffbeb] border border-[#fde68a] mb-4">
            <AlertTriangle className="w-4 h-4 text-[#92400e] shrink-0 mt-0.5" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-xs text-[#92400e]">
              Esta ruta tiene viajes asociados. Los cambios afectarán dichos viajes.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Destino"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Ej. La Olla"
            error={fieldError}
          />
        </form>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          loading={loading}
          feedback={feedback}
          onClick={handleSubmit}
        >
          {isEdit ? 'Guardar cambios' : 'Crear ruta'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
