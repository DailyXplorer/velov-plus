"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";

export function Brand() {
  return <a className="brand" href="#overview" aria-label="Vélo’v, accueil">Vélo’v</a>;
}

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
