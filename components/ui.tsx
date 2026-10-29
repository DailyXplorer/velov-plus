"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRightIcon, ArrowUpRightIcon, type Icon, SpinnerGapIcon } from "./icons";

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

/** `hideLabel` keeps the label for screen readers only, when the selected value already says what the control is.
 * `short` is the trigger's label on phones; the popover always lists the full labels. */
export function SelectField<T extends string>({ label, hideLabel = false, value, options, onChange, className = "" }: { label: string; hideLabel?: boolean; value: T; options: { value: T; label: string; short?: string }[]; onChange: (value: T) => void; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLUListElement>(null);
  const selected = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    listbox.current?.focus({ preventScroll: true });
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (open) listbox.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    setActive(selected);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function choose(index: number) {
    const next = options[index];
    if (next && next.value !== value) onChange(next.value);
    close();
  }

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    show();
  }

  function onListKeyDown(event: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowDown: Math.min(active + 1, options.length - 1), ArrowUp: Math.max(active - 1, 0), Home: 0, End: options.length - 1 };
    if (event.key === "Tab") return setOpen(false);
    if (event.key in moves) setActive(moves[event.key]);
    else if (event.key === "Enter") choose(active);
    else if (event.key === "Escape") close();
    else if (event.key !== " ") return;
    event.preventDefault();
  }

  // Space selects on keyup so the trigger, focused again by then, does not reopen on the same keystroke.
  function onListKeyUp(event: KeyboardEvent) {
    if (event.key === " ") choose(active);
  }

  return (
    <div className={`select-field ${className}`}>
      <span className={hideLabel ? "sr-only" : "select-label"} id={`${id}-label`}>{label}</span>
      <div className="select-control" ref={root}>
        <button ref={trigger} type="button" className="select-trigger" aria-haspopup="listbox" aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined} aria-labelledby={`${id}-label ${id}-value`}
          onClick={() => (open ? close() : show())} onKeyDown={onTriggerKeyDown}>
          <span className="select-value" id={`${id}-value`}>
            {options.map((option, index) => (
              <span key={option.value} aria-hidden={index !== selected || undefined}>
                {option.short ? <><span className="select-long">{option.label}</span><span className="select-short">{option.short}</span></> : option.label}
              </span>
            ))}
          </span>
          <span className="select-chevron"><ArrowRightIcon size={13} weight="bold" aria-hidden="true"/></span>
        </button>
        {open ? (
          <ul ref={listbox} id={`${id}-list`} className="select-popover" role="listbox" tabIndex={-1} aria-labelledby={`${id}-label`}
            aria-activedescendant={`${id}-option-${active}`} onKeyDown={onListKeyDown} onKeyUp={onListKeyUp}>
            {options.map((option, index) => (
              <li key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={index === selected}
                className={`select-option${index === active ? " is-active" : ""}`}
                onPointerEnter={() => setActive(index)} onClick={() => choose(index)}>
                {option.label}
              </li>
            ))}
          </ul>
        ) : null}
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

export function Modal({ children, titleId, onClose, className = "" }: { children: ReactNode; titleId: string; onClose: () => void; className?: string }) {
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
    <dialog className={`modal ${className}`} ref={element} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}

