"use client";

import { useState, type FormEvent } from "react";
import { MapPinIcon } from "./icons";
import { Button } from "./ui";
import { loginError } from "@/lib/models";

export function Login({ onConnected, onGuest, notice = null }: { onConnected: () => void; onGuest: () => void; notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(notice ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code })
      });
      const text = await response.text();
      if (!response.ok) {
        setError(loginError(text));
        return;
      }
      setCode("");
      onConnected();
    } catch {
      setError("Connexion impossible. Vérifiez votre connexion Internet.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-content" aria-labelledby="login-title">
        <h1 id="login-title">Vélo’v<span className="brand-plus">+</span></h1>
        <form onSubmit={submit} className="login-form" aria-label="Connexion Vélo’v">
          <input
            name="email" type="email" autoComplete="username" aria-label="Adresse e-mail"
            placeholder="Adresse e-mail" required maxLength={254}
            value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending}
          />
          <input
            name="password" type="password" inputMode="numeric" autoComplete="current-password"
            aria-label="Code secret à 6 chiffres" placeholder="Code secret"
            pattern="[0-9]{6}" minLength={6} maxLength={6} required
            value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={pending}
          />
          <Button type="submit" pending={pending}>
            Se connecter
          </Button>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </form>
        <Button variant="ghost" className="login-guest" disabled={pending} onClick={onGuest}><MapPinIcon size={18} weight="light" aria-hidden="true"/>Continuer sans compte</Button>
      </section>
    </main>
  );
}
