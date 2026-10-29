# Statistiques : audit des données

Ce document liste les données que l’onglet « Statistiques » utilise, d’où elles viennent et ce qui manque. Les chiffres sont calculés par `lib/stats.ts` (fonctions pures, testées dans `test/stats.test.ts`) et servis par `GET /api/stats`.

## Ce que l’application lit déjà (`lib/velov.ts`)

| Lecture | Champs utiles aux statistiques |
| --- | --- |
| `GET /accounts/{id}/trips?status=FINISHED&status=ERROR&status=REVERSED` (`application/vnd.trip.v6+json`) | `startDateTime`, `endDateTime` (UTC sans fuseau), `startStation`, `endStation` (numéros), `startStationName`, `endStationName`, `duration` (minutes arrondies au supérieur), `bikeType` (`0` mécanique, `1` électrique), `bikeNumber`, `price`, `discount`, `reducedPrice` (centimes), `rewardsEarned`, `rewardsSpent`, `status` |
| GBFS `station_information.json` | Nom et coordonnées (`lat`, `lon`) de chaque station ouverte aujourd’hui |
| `GET /accounts/{id}/rewards` | Solde de points actuel (`balance`) et total gagné |
| `GET /accounts/{id}/rewards/history?page=N` | Mouvements de points : date, sens (`CREDIT` / `DEBIT`), montant, motif. Page Spring de 200 mouvements |
| `GET /accounts/{id}/subscriptions` | Formule et périodes. Non utilisé par les statistiques |

`normalizeTrip` (`lib/cyclocity.ts`) convertit chaque trajet brut en `Trip` (`lib/models.ts`). Les coordonnées d’un trajet viennent de la liste GBFS du jour, pas du trajet lui-même.

## Ce que Cyclocity propose (`docs/api/community-README.md`, § 5.6 et § 5.8)

- **Historique des trajets.** `GET /trips` rend un tableau JSON, les trajets les plus récents en premier. Aucune pagination n’est documentée : l’app officielle lit la liste sans paramètre. Un essai avec `?page=0&size=200` a répondu sans erreur.
- **Effacement.** Vélo’v retire `bikeNumber`, `startStation`, `endStation` et les bornes d’un trajet bien avant le seuil annoncé de 180 jours (observé sur un trajet de 12 jours). Les trajets d’environ 13 mois disparaissent de `GET /trips`, bien avant la purge annoncée à 780 jours.
- **`GET /sales?infoType=TRIP`** garde les trajets payants en entier, mais ne contient pas les trajets compris dans la formule. L’onglet ne le lit pas.
- **Points.** `rewards/history` est une page Spring paginée (`page`, `totalPages`).
- **Distance.** Aucun champ ne donne la distance parcourue. La trace GPS (`/trips/{tripId}/route`) n’est pas vérifiée et n’est pas lue.

## Lecture de l’historique complet

`getStats` lit les trajets avec `&page=N&size=100`, une page après l’autre (jamais en parallèle), et lit ensuite les points de la même façon. La lecture s’arrête :

- à la première page vide ;
- à une page qui n’apporte aucun trajet nouveau (cas d’un serveur qui ignore `page` : deux lectures au plus) ;
- après 50 pages (l’historique est alors marqué incomplet).

Une page en échec après la première garde les pages déjà lues et marque l’historique incomplet. Chaque lecture passe par `fetchTransient` : nouvel essai sur 502, 503, 504 ou panne réseau, jamais sur un délai dépassé. Le résultat est gardé 10 minutes par compte côté serveur, et pour la durée de l’onglet côté navigateur.

## Calculs et limites

- **Trajets comptés.** Tous les trajets de l’historique sauf ceux au statut `REVERSED` (annulés).
- **Périodes.** 30 derniers jours (par jour), 12 derniers mois (par mois), depuis le début (par mois). Les jours, heures et jours de la semaine sont en heure de Paris.
- **Km estimés.** Distance en ligne droite entre les deux stations (formule de haversine), multipliée par 1,3 pour les détours. Un retour à la même station compte 0 km. La distance est inconnue quand le trajet n’a plus ses stations, ou quand une station n’existe plus dans la liste GBFS. L’interface dit « km estimés » et indique le nombre de trajets sans distance.
- **CO₂ évité estimé.** 200 g de CO₂ par km estimé, ordre de grandeur d’une voiture thermique en ville. Le facteur est affiché en note sous les cartes.
- **Dépenses.** Somme des prix payés après réduction ; les économies sont la somme des réductions (`discount`).
- **Points gagnés.** Somme des crédits de `rewards/history` sur la période. Si cet historique est indisponible, somme des `rewardsEarned` des trajets.
- **Évolution des points.** Solde à la fin de chaque jour ou mois : solde actuel moins les mouvements postérieurs.
- **Trajets sans stations.** Comptés et signalés (« 12 trajets sans stations : Vélo’v a effacé ces données »). Ils comptent dans les trajets, les minutes, les dépenses et le type de vélo, mais pas dans les stations, les trajets favoris ni les km.
- **Historique tronqué.** Les trajets que `GET /trips` ne rend plus (environ 13 mois et plus) sont absents : « Depuis le début » commence au plus ancien trajet encore rendu.
