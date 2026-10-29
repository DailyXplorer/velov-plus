"use client";

import { useState, type FormEvent } from "react";
import { Button } from "./ui";

export function Login({ onConnected }: { onConnected: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

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
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
          ? data.error : "Connexion impossible. Réessayez.";
        setError(message);
        return;
      }
      setCode("");
      onConnected();
    } catch {
      setError("Connexion impossible. Vérifiez votre accès à Internet.");
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
            name="email" type="email" autoComplete="username" aria-label="Adresse email"
            placeholder="Adresse email" required maxLength={254}
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
      </section>
    </main>
  );
}
