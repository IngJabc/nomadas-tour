"use client";

import { useState, useEffect, useId } from "react";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { AgencyData } from "./AgencyCard";

interface AgencyFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  agency?: AgencyData | null;
  onClose: () => void;
  onSubmit: (data: { name: string; email?: string }) => Promise<void>;
}

export function AgencyFormModal({
  open,
  mode,
  agency,
  onClose,
  onSubmit,
}: AgencyFormModalProps) {
  const instanceId = useId();
  const titleId = `agency-form-title-${instanceId}`;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<"success" | "error" | null>(null);
  const [fieldError, setFieldError] = useState("");

  const isEdit = mode === "edit";

  useEffect(() => {
    if (open) {
      if (isEdit && agency) {
        setName(agency.name);
        setEmail(agency.email || "");
      } else {
        setName("");
        setEmail("");
      }
      setLoading(false);
      setFeedback(null);
      setFieldError("");
    }
  }, [open, isEdit, agency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError("");

    if (!name.trim() || name.trim().length < 2) {
      setFieldError("El nombre debe tener al menos 2 caracteres.");
      return;
    }

    if (!isEdit && !email.trim()) {
      setFieldError("El correo electrónico es requerido.");
      return;
    }

    if (!isEdit && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError("Ingresa un correo electrónico válido.");
      return;
    }

    setLoading(true);
    try {
      if (isEdit) {
        await onSubmit({ name: name.trim() });
      } else {
        await onSubmit({ name: name.trim(), email: email.trim() });
      }
      setFeedback("success");
      setTimeout(() => onClose(), 600);
    } catch {
      setFeedback("error");
      setTimeout(() => setFeedback(null), 1500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" titleId={titleId}>
      <ModalHeader>
        <h2
          id={titleId}
          className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)]"
        >
          {isEdit ? "Editar agencia" : "Nueva agencia"}
        </h2>
      </ModalHeader>

      <ModalBody>
        {fieldError && (
          <div className="mb-4 p-3 rounded-xl bg-[#fef2f2] border border-[#fee2e2] font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
            {fieldError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Nombre de la agencia"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Agencia Central"
          />
          {!isEdit && (
            <Input
              label="Correo de la agencia"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@agencia.com"
            />
          )}
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
          {isEdit ? "Guardar cambios" : "Crear agencia"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
