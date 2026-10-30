import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-layout">
      <section className="login-content not-found" aria-labelledby="not-found-title">
        <h1 id="not-found-title">Vélo’v<span className="brand-plus">+</span></h1>
        <p className="not-found-message">Cette page n’existe pas.</p>
        <Link href="/" className="button button-primary not-found-home"><span className="button-content">Retour à l’accueil</span></Link>
      </section>
    </main>
  );
}
