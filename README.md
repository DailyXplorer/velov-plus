# Vélo’v+

Vélo’v+ est un compagnon personnel pour le Vélo’v, le service de vélos en libre-service de Lyon. Il rassemble dans une seule page web ce que l’application officielle répartit sur plusieurs écrans : les stations autour de soi, les vélos disponibles, le trajet en cours, les points de fidélité et l’historique des déplacements.

Le projet est non officiel. Il n’est ni affilié à JCDecaux, ni à Cyclocity, ni à la Métropole de Lyon, et il s’appuie sur une API privée qui peut changer à tout moment.

Le site est en ligne à l’adresse **[velovplus.vercel.app](https://velovplus.vercel.app)**. Une application iOS compagnon est développée dans le dépôt [velov-plus-ios](https://github.com/DailyXplorer/velov-plus-ios).

## Ce que permet l’application

La connexion se fait avec l’adresse e-mail et le code secret à six chiffres du compte Vélo’v. Une fois connecté, l’utilisateur retrouve son abonnement, ses alertes de compte et ses stations favorites sur la vue d’ensemble.

La carte des stations affiche les disponibilités en temps réel à partir des flux publics GBFS. On peut y chercher une station par son nom, n’afficher que les favorites, les stations qui ont des vélos électriques ou des places libres, et se localiser à la demande. Chaque station ouvre la liste de ses vélos, avec une note qui recommande le meilleur vélo mécanique et le meilleur vélo électrique et signale ceux qu’il vaut mieux éviter.

- Un vélo peut être réservé pour quinze minutes en échange de dix points, puis déverrouillé depuis le bandeau de réservation ou depuis sa fiche.
- Pendant un trajet, l’application suit le vélo jusqu’à son retour en station, puis propose de noter le vélo.
- Quand la station d’arrivée est pleine, le trajet en cours permet de demander quinze minutes de plus pour rejoindre une autre station.
- L’onglet Statistiques calcule les distances estimées, le CO₂ évité, les heures et les stations les plus fréquentes sur tout l’historique.
- L’onglet Points montre le solde et les mouvements, règle l’utilisation automatique des points et permet d’obtenir un code à offrir à un ami.
- L’onglet Compte permet de modifier ses coordonnées, de télécharger les reçus d’abonnement, de régler le renouvellement automatique et d’écrire au service client.

## Fonctionnement

L’application est écrite avec Next.js 16 et React 19, en TypeScript, et elle est hébergée sur Vercel. Le navigateur ne parle qu’aux routes de l’application, sous `app/api/`. Ce sont ces routes, exécutées côté serveur, qui interrogent l’API Cyclocity et les flux GBFS. Aucun secret personnel n’est présent dans le dépôt ni dans le JavaScript envoyé au navigateur.

La connexion suit le protocole OpenID Connect avec PKCE auprès du fournisseur d’identité de Cyclocity. Le code secret ne sert que pendant la connexion et n’est jamais enregistré. Les jetons sont conservés dans des cookies HttpOnly, propres à chaque navigateur et marqués Secure en HTTPS. Quand le jeton d’accès expire, le jeton de renouvellement en obtient un nouveau, et les requêtes simultanées partagent ce renouvellement pour ne pas consommer deux fois un jeton à usage unique. La session n’est fermée que si le fournisseur d’identité refuse explicitement le jeton de renouvellement. Les requêtes de connexion, de déconnexion et de modification doivent venir du site lui-même, ce que le serveur vérifie avec l’en-tête Origin.

Les actions qui modifient quelque chose sur le compte suivent trois règles de sécurité.

1. Chaque action passe par une seule confirmation, et chaque confirmation envoie exactement une requête. Cela concerne la réservation, le déverrouillage, la note d’un vélo, la prolongation, le code promo et les réglages du compte.
2. Aucune action n’est relancée automatiquement. Seules les lectures sont répétées quand la passerelle de Cyclocity renvoie une erreur 502 ou que le réseau échoue, ce qui arrive souvent. Une action perdue en route n’est jamais renvoyée, car elle a peut-être déjà abouti : un vélo peut avoir été libéré, des points peuvent avoir été débités.
3. Un échec n’est pas toujours un refus. Quand Vélo’v refuse clairement, le message s’affiche et l’utilisateur peut confirmer de nouveau. Quand la réponse manque, arrive en retard ou ne prouve rien, le résultat est incertain : l’application le dit et ne propose plus de confirmer. Elle relit l’état réel du compte, et ne propose de recommencer que si cette lecture prouve que rien n’a changé. Le temps qui passe ne prouve rien : un déverrouillage incertain reste bloqué jusqu’à ce que la relecture des trajets montre un trajet avec ce vélo, ou aucun trajet une fois passé le délai pour retirer le vélo. Une réservation incertaine attend de même la relecture des réservations. Pour une invitation, seul un historique de points complet depuis la demande, sans débit du coût, permet de recommencer ; un solde ne suffit jamais. Une action en attente ou incertaine reste suivie quand on ferme la fenêtre, et une seule action à la fois peut être envoyée, même depuis plusieurs onglets : le navigateur doit pour cela savoir verrouiller entre onglets, sinon la réservation, le déverrouillage et l’invitation sont refusés avant tout envoi. Les actions ne suivent jamais de redirection. Le succès d’un déverrouillage dépend de l’état de transaction renvoyé par Vélo’v, jamais du seul code HTTP.

Le serveur de Vélo’v ne vérifie pas où se trouve l’utilisateur. L’application affiche donc un avertissement quand la position connue est à plus de deux cents mètres de la station au moment de déverrouiller.

Quelques formats d’API n’ont pas encore été confirmés par un envoi réel. Ils sont décrits avec leurs sources dans [docs/api/hypotheses.md](docs/api/hypotheses.md).

## Lancer le projet en local

Le projet demande Node.js 22.13 ou plus récent. Aucune variable d’environnement ni base de données n’est nécessaire.

```sh
npm ci
npm run dev
```

Le serveur de développement écoute sur http://127.0.0.1:3000. La connexion utilise un vrai compte Vélo’v, et les actions effectuées en local agissent réellement sur ce compte.

Les tests utilisent le lanceur intégré à Node. Ils n’envoient aucune requête réseau : chaque appel passe par une fausse implémentation de `fetch`, et la vraie échoue volontairement si un test l’atteint.

```sh
npm test
npm run typecheck
npm run build
```

## Déploiement

Le site est déployé sur Vercel. Comme il ne dépend d’aucune variable d’environnement, un déploiement standard suffit, avec `vercel deploy` pour une préversion et `vercel deploy --prod` pour la production. Le fichier `.vercelignore` retire les tests du paquet envoyé.

## Structure du projet

- `app/` contient la page unique de l’application et les routes serveur de `app/api/`.
- `components/` contient l’interface React : carte, fiches des stations et des vélos, statistiques, compte.
- `lib/` contient le client Cyclocity, la gestion de session, les modèles validés avec Zod et les calculs purs.
- `test/` contient les tests unitaires.
- `docs/` contient la documentation de l’API et les notes sur les statistiques.

## Documentation

La [documentation communautaire de l’API Cyclocity](docs/api/community-README.md), écrite par Yann Lombard et publiée sous licence CC BY 4.0, décrit les routes utilisées par l’application. Elle est accompagnée de sa description OpenAPI et de sa collection Postman dans le même dossier. La note [docs/stats.md](docs/stats.md) explique d’où viennent les chiffres de l’onglet Statistiques et quelles sont leurs limites.

## Avertissement

Vélo’v+ utilise une API privée, sans documentation officielle ni garantie. Elle peut changer ou cesser de fonctionner sans préavis. L’application est destinée à un usage personnel, avec son propre compte, dans le respect des conditions d’utilisation du service Vélo’v. Elle ne doit pas servir à automatiser des actions ni à interroger le service de façon répétée. Les actions sont réelles : une réservation coûte des points et un déverrouillage démarre un trajet facturé.

## Licence

Projet personnel, tous droits réservés. Les fichiers `docs/api/community-*` et `docs/api/cyclocity.community.*` restent la propriété de leur auteur et sont distribués sous licence CC BY 4.0.
