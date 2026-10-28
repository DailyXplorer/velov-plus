"use client";

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  pending?: boolean;
};

export function Button({ variant = "primary", pending = false, className = "", children, disabled, ...props }: ButtonProps) {
  return (
    <button type="button" {...props} disabled={disabled || pending} aria-busy={pending || undefined} className={`button button-${variant} ${className}`}>
      <span className="button-content">{children}</span>
      {pending ? <SpinnerGapIcon size={18} className="button-spinner spin" aria-hidden="true"/> : null}
    </button>
  );
}

export function TextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="text-button" onClick={onClick}>{children}</button>;
}

export function CircleArrow({ external = false, outline = false }: { external?: boolean; outline?: boolean }) {
  const Arrow = external ? ArrowUpRightIcon : ArrowRightIcon;
  return <span className={`circle-arrow${outline ? " is-outline" : ""}`}><Arrow size={13} weight="bold" aria-hidden="true"/></span>;
}


export function Eyebrow({ icon: TagIcon, children }: { icon: Icon; children: ReactNode }) {
  return <span className="eyebrow"><span className="eyebrow-icon"><TagIcon size={13} weight="bold" aria-hidden="true"/></span>{children}</span>;
}

export function CardTag({ icon: TagIcon, children }: { icon: Icon; children: ReactNode }) {
  return <span className="card-tag"><span className="card-tag-icon"><TagIcon size={13} weight="bold" aria-hidden="true"/></span>{children}</span>;
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const id = useId();
  return (
    <div className="select-field">
      <label htmlFor={id}>{label}</label>
      <div className="select-control">
        <select id={id} value={value} onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) onChange(next.value);
        }}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <CaretDownIcon size={14} weight="light" aria-hidden="true"/>
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

export function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="section-heading"><h2>{title}</h2>{children}</div>;
}

export function Modal({ children, titleId, onClose }: { children: ReactNode; titleId: string; onClose: () => void }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = element.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog className="modal" ref={element} aria-labelledby={titleId} onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
