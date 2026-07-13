'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';

const STEPS = [
  { label: 'Ruta', short: 'Ruta' },
  { label: 'Programación', short: 'Prog.' },
  { label: 'Vehículo', short: 'Veh.' },
  { label: 'Agencias', short: 'Ag.' },
  { label: 'Revisión', short: 'Rev.' },
];

interface StepIndicatorProps {
  currentStep: number;
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <nav aria-label="Progreso del formulario" className="w-full">
      <ol className="flex items-center justify-between">
        {STEPS.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <li key={index} className="flex items-center gap-2.5">
              <div className="relative w-8 h-8 shrink-0">
                <div
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center
                    text-xs font-[family-name:var(--font-body)] font-semibold
                    transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                    ${isCompleted || isCurrent ? 'bg-[var(--color-brand-cyan)] text-white' : 'bg-slate-100 text-[var(--color-brand-muted)]'}
                  `}
                >
                  <AnimatePresence mode="wait">
                    {isCompleted ? (
                      <motion.span
                        key="check"
                        initial={{ scale: 0, rotate: -90 }}
                        animate={{ scale: 1, rotate: 0 }}
                        exit={{ scale: 0, rotate: 90 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                      >
                        <Check className="w-4 h-4" strokeWidth={2.5} />
                      </motion.span>
                    ) : (
                      <motion.span
                        key={`num-${index}`}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                      >
                        {index + 1}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                {isCurrent && (
                  <span
                    className="absolute inset-0 rounded-full animate-ping opacity-20"
                    style={{ backgroundColor: 'var(--color-brand-cyan)' }}
                  />
                )}
              </div>
              <span
                className={`
                  hidden sm:inline font-[family-name:var(--font-body)] text-xs font-semibold
                  transition-colors duration-200
                  ${isCurrent ? 'text-[var(--color-brand-navy)]' : ''}
                  ${isCompleted ? 'text-[var(--color-brand-cyan)]' : ''}
                  ${!isCompleted && !isCurrent ? 'text-[var(--color-brand-muted)]' : ''}
                `}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
