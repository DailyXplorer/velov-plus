"use client";

import { useState, type FormEvent } from "react";
import { MapPinIcon } from "./icons";
import { Button } from "./ui";
import { loginError } from "@/lib/models";
import { forgetting } from "@/lib/forget";

const GUEST_FAILED = "Impossible de continuer sans compte. Réessayez.";

export function Login({ onConnected, onGuest, notice = null }: { onConnected: () => void; onGuest: () => void; notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"login" | "guest" | null>(null);
  const [error, setError] = useState(notice ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("login");
    setError("");
    try {
      await forgetting.settled();
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
      setBusy(null);
    }
  }

  async function continueAsGuest() {
    if (busy) return;
    setBusy("guest");
    setError("");
    if (await forgetting.forget()) { onGuest(); return; }
    setError(GUEST_FAILED);
    setBusy(null);
  }

  return (
    <main className="login-layout">
      <section className="login-content" aria-labelledby="login-title">
        <h1 id="login-title">Vélo’v<span className="brand-plus">+</span></h1>
        <form onSubmit={submit} className="login-form" aria-label="Connexion Vélo’v">
          <input
            name="email" type="email" autoComplete="username" aria-label="Adresse e-mail"
            placeholder="Adresse e-mail" required maxLength={254}
            value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy !== null}
          />
          <input
            name="password" type="password" inputMode="numeric" autoComplete="current-password"
            aria-label="Code secret à 6 chiffres" placeholder="Code secret"
            pattern="[0-9]{6}" minLength={6} maxLength={6} required
            value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy !== null}
          />
          <Button type="submit" pending={busy === "login"} disabled={busy !== null}>
            Se connecter
          </Button>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </form>
        <Button variant="ghost" className="login-guest" pending={busy === "guest"} disabled={busy !== null} onClick={continueAsGuest}><MapPinIcon size={18} weight="light" aria-hidden="true"/>Continuer sans compte</Button>
      </section>
    </main>
  );
}
