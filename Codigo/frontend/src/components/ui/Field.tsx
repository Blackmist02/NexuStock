"use client";

import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldProps {
  label: string;
  error?: string | null;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

/** Etiqueta + control + mensaje de error (clase global .fieldgrp). */
export function Field({ label, error, hint, htmlFor, children, className }: FieldProps) {
  return (
    <div className={["fieldgrp", className].filter(Boolean).join(" ")}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="field-err" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

type BaseProps = { label: string; error?: string | null; hint?: string; className?: string };

/** Campo de texto con etiqueta. Usa el aspecto `.input` del diseño. */
export function TextField({ label, error, hint, className, id, ...rest }: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={fid} className={className}>
      <input id={fid} className={`input${error ? " err" : ""}`} aria-invalid={!!error} {...rest} />
    </Field>
  );
}

export function SelectField({ label, error, hint, className, id, children, ...rest }: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={fid} className={className}>
      <select id={fid} className={`input${error ? " err" : ""}`} aria-invalid={!!error} {...rest}>
        {children}
      </select>
    </Field>
  );
}

export function TextAreaField({ label, error, hint, className, id, ...rest }: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={fid} className={className}>
      <textarea id={fid} className={`input area${error ? " err" : ""}`} aria-invalid={!!error} {...rest} />
    </Field>
  );
}

/** Valor de solo lectura con el aspecto de campo (`.input.ro`). */
export function ReadOnlyField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Field label={label} className={className}>
      <div className="input ro">{children}</div>
    </Field>
  );
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "block";
  loading?: boolean;
}

/** Botón del diseño (.btn) con estado de carga. */
export function Button({ variant = "ghost", size = "md", loading, disabled, className, children, type = "button", ...rest }: BtnProps) {
  const cl = ["btn", variant, size === "sm" ? "sm" : size === "block" ? "block" : "", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cl} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Interruptor (.switch) accesible. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={`switch ${checked ? "on" : "off"}`} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  );
}
