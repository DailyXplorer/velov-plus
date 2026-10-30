# Mode sans compte : inventaire

Ce document classe chaque écran, bouton et appel d’API de Vélo’v+ en deux groupes. Une fonction **publique** marche sans compte Vélo’v. Une fonction **compte** a besoin des jetons de l’utilisateur. Le mode sans compte n’affiche que les fonctions publiques.

## Appels à Cyclocity sans authentification

Mesures faites le 30 octobre 2026 depuis le serveur de développement, avec `curl`, en GET uniquement, sans en-tête `Authorization`, sans `Identity` et sans cookie. Seul un User-Agent de navigateur est envoyé, car le pare-feu de Cyclocity refuse les User-Agent de scripts.

| Endpoint | Sans authentification | Statut HTTP obtenu |
| --- | --- | --- |
| `GET /contracts/lyon/gbfs/v3/gbfs.json` | Oui | 200 |
| `GET /contracts/lyon/gbfs/v3/station_information.json` | Oui | 200 |
| `GET /contracts/lyon/gbfs/v3/station_status.json` | Oui | 200 |
| `GET /contracts/lyon/gbfs/v3/system_information.json` | Oui | 200 |
| `GET /contracts/lyon/gbfs/v3/vehicle_types.json` | Oui | 200 |
| `GET /contracts/lyon/gbfs/v3/gbfs_versions.json` | Oui | 200 |
| `GET /contracts/lyon/gbfs/v3/system_pricing_plans.json` | Non publié | 404 |
| `GET /contracts/lyon/stations` (`vnd.station.v4+json`) | Non | 403 `role.not.allowed` |
| `GET /contracts/lyon/stations/2002` (`vnd.station.v4+json`) | Non | 403 `role.not.allowed` |
| `GET /contracts/lyon/bikes?stationNumber=2002` (`vnd.bikes.v4+json`) | Non | 403 `role.not.allowed` |
| `GET /contracts/lyon/bikes?number=1000` (`vnd.bikes.v4+json`) | Non | 403 `role.not.allowed` |

Les flux GBFS sont donc publics. Ils suffisent pour la carte, la recherche, les filtres et les disponibilités de chaque station.

Les vélos d’une station et la fiche d’un vélo demandent le jeton d’application (`Authorization: Taknv1 …`). Ce jeton appartient à l’application, pas à l’utilisateur : le serveur de Vélo’v+ l’obtient avec la clé du client web, sans compte et sans connexion. Les routes `GET /api/stations/{numéro}/bikes` et `GET /api/bikes/{numéro}` ne lisent donc aucun cookie et servent déjà tout visiteur. L’obtention du jeton est une requête POST vers `client_tokens` : elle n’a pas été rejouée à la main pour cette mesure, puisque seuls des GET étaient permis. Le site de production est derrière l’authentification Vercel (réponse 302) et n’a pas pu servir de preuve depuis ce serveur.

Les offres et les tarifs ne sont pas publiés en GBFS (`system_pricing_plans.json` répond 404). L’application ne les affiche pas aujourd’hui, le mode sans compte non plus.

## Écrans et boutons

| Élément | Groupe | Mode sans compte |
| --- | --- | --- |
| Carte des stations, pins, disponibilités | Public (GBFS) | Affiché |
| Recherche d’une station | Public | Affiché |
| Filtres Toutes, Vélos dispo, Électriques, Places | Public | Affiché |
| Filtre Favorites et étoile d’une station | Compte (favoris du profil) | Remplacé par des favoris gardés dans le navigateur |
| Autour de moi | Public (position du navigateur) | Affiché |
| Itinéraire | Public (lien Google Maps) | Affiché |
| Liste des vélos d’une station, note, batterie, vélo recommandé | Public (jeton d’application) | Affiché |
| Fiche d’un vélo | Public (jeton d’application) | Affichée, avec un bouton « Se connecter » dans la rangée d’actions, seulement pour un vélo disponible, non réservé et en station |
| Réserver, Déverrouiller, bandeau de réservation | Compte | Absent |
| Vue d’ensemble (points, trajets, abonnement, derniers trajets) | Compte | Absente |
| Trajet en cours, Via (15 minutes de plus), Trajet terminé et note du vélo | Compte | Absent |
| Onglet Trajets et fiche d’un trajet | Compte | Absent |
| Onglet Statistiques | Compte | Absent |
| Onglet Points, utilisation automatique, invitation d’un ami | Compte | Absent |
| Onglet Compte : coordonnées, reçus, renouvellement, service client, déconnexion | Compte | Absent |
| Actualiser | Public pour les stations | Actualise les stations |

## Routes de l’application

| Route | Groupe | Appelée en mode sans compte |
| --- | --- | --- |
| `GET /api/stations` | Public | Oui |
| `GET /api/stations/{numéro}/bikes` | Public | Oui |
| `GET /api/bikes/{numéro}` | Public | Non (ouverte depuis un trajet) |
| `POST /api/auth/login` | Connexion | Seulement depuis la page de connexion |
| `POST /api/auth/forget` | Connexion, sans appel à Vélo’v | Une fois, en passant au mode sans compte, pour effacer les cookies d’une session expirée |
| `GET /api/auth/session`, `POST /api/auth/logout` | Compte | Non |
| `GET /api/dashboard`, `GET /api/stats`, `GET /api/trips/current` | Compte | Non |
| `GET`, `POST /api/bookings`, `POST /api/unlock` | Compte | Non |
| `POST /api/trips/{id}/rate` | Compte | Non |
| `GET`, `PATCH /api/account/rewards`, `POST /api/account/promocode` | Compte | Non |
| `PATCH /api/account/profile`, `PATCH /api/account/auto-renewal` | Compte | Non |
| `POST`, `DELETE /api/account/favorites/{numéro}` | Compte | Non |
| `POST /api/account/receipts`, `POST /api/account/contact`, `POST /api/account/via` | Compte | Non |
