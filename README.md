# Vélo’v — compagnon personnel

Interface Next.js en DM Sans, rouge et blanc, inspirée du rythme et des composants de Murmur.

## Développement

Node.js 24 recommandé. Exécuter `npm install`, puis `npm run dev`.
La connexion utilise l’email et le code secret à six chiffres du compte Vélo’v. Aucun fichier `.env` ni mot de passe enregistré n’est nécessaire.

## Fonctionnement

- Connexion OIDC avec PKCE, validation des jetons et protection des requêtes de connexion/déconnexion par origine.
- Session propre à chaque navigateur, dans des cookies HttpOnly, Secure en hébergement HTTPS. Renouvellement automatique tant que le fournisseur accepte le jeton de renouvellement.
- Profil, abonnement, trajets, points et mouvements provenant du compte connecté.
- Carte et disponibilités des stations issues des flux GBFS publics de Cyclocity, avec recherche, filtres et géolocalisation à la demande.

Le code secret est utilisé pendant la connexion puis abandonné. Aucun jeton personnel n’est embarqué dans le dépôt ou le JavaScript du navigateur. La session locale du Mac ne fait pas partie de ce projet.

Réserver et déverrouiller un vélo ne sont pas encore activés : ces actions attendent une validation en station. La gestion du profil et des réglages de fidélité renvoie au service officiel. Les connexions Apple et Google ne sont pas intégrées.

## Vérification et hébergement

`npm run test:auth` couvre le protocole de connexion et de renouvellement sans utiliser de vrais identifiants. `npm run typecheck` vérifie les types.

Le projet est lié au projet Vercel **velov-compagnon**, dans l’espace **dailyxplorer**. Un déploiement standard `vercel deploy` produit une Preview ; conserver la protection Vercel du projet.

La police DM Sans est hébergée dans `public/fonts`, sous licence OFL jointe.
