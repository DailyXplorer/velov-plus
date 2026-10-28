# Utiliser son compte Vélo'v dans une application personnelle

Enquête du 28 octobre 2026 sur Vélo'v officiel, Lyon, contrat Cyclocity `lyon`.

Mise à jour à 12 h 58 UTC. La connexion personnelle par HTTP et les lectures du profil, des points, des abonnements, des trajets, des réservations courantes et de la validité du paiement sont désormais vérifiées. Le [résultat de connexion](RESULTAT-CONNEXION.md) complète le relevé initial ci-dessous. La liste détaillée des vélos reste en `403`, même connectée. Les opérations de réservation et de libération restent non exécutées. L'archive initiale conserve le relevé antérieur à ce test personnel.

Mise à jour à 13 h 32 UTC. La [session persistante](SESSION-PERSISTANTE.md) est activée dans le Trousseau macOS. Son renouvellement sans identifiants et sa reprise dans un nouveau processus sont vérifiés. Le serveur annonce trente minutes pour l'access token et trente jours initiaux pour le refresh token. Le code secret n'est pas conservé.

## Vue d'ensemble

Les appels du compte, des points, de la réservation et du déverrouillage sont identifiés. Ils appartiennent à l'API privée Cyclocity utilisée par les clients officiels. Il existe aussi un client Swift indépendant qui implémente cette connexion.

Cela donne une base concrète pour un prototype personnel. La connexion complète avec ton compte est maintenant validée par HTTP. La réservation et la libération physique d'un vélo restent à valider. Deux difficultés sont observées dans cette enquête. Les URL de retour personnelles testées sont refusées par le serveur de connexion. La route des vélos détaillés renvoie actuellement un `403` HTML dans cet environnement.

Le dossier permet de distinguer trois niveaux de preuve.

| Niveau | Ce qu'il établit |
| --- | --- |
| Vérification directe | Réponse HTTP obtenue le 28 octobre, sans connexion à un compte personnel. |
| Déclaration du site officiel | URL, configuration ou code relevé dans le JavaScript actuellement livré par Vélo'v. Cela ne prouve pas un succès côté serveur. |
| Recherche communautaire originale | Captures réseau ou décompilation Android publiées par Yann Lombard, ou code de Fyroeo/VLSKit. Ces résultats sont attribués à leurs auteurs et n'ont pas été reproduits avec ton compte. |

## Les concepts à garder séparés

| Élément | Valeur ou rôle | Preuve |
| --- | --- | --- |
| API métier | `https://api.cyclocity.fr` | Configuration du site et requêtes directes. |
| Contrat | `lyon` | Configuration et `GET /contracts/lyon`. |
| Fournisseur d'identité | `https://iam.cyclocity.fr/realms/vls-default` | Découverte OIDC directe. |
| Jeton applicatif | `Authorization: Taknv1 {clientToken}` | Code du site et requêtes directes. |
| Jeton personnel | `Identity: {keycloak_access_token}` | Intégration Keycloak du site et captures communautaires. Aucun préfixe `Bearer` dans cet en-tête. |
| Identifiant du compte | UUID obtenu par `/accounts/{email}/id` | Déclaration du site et captures communautaires. |
| Identifiant d'abonnement | UUID `id` d'une formule courante autorisant la location | Captures et interfaces Android rapportées. |
| Identifiant du vélo | UUID `id` pour réserver, numéro entier pour libérer | Interfaces Android rapportées. |

Un jeton applicatif ne connecte pas l'utilisateur. Le code et la clé de l'application web sont distribués publiquement à tous les visiteurs du site. Ils ne remplacent ni l'identité du compte ni un abonnement valide.

## Comment la connexion fonctionne

### 1. Obtenir le jeton applicatif

```http
POST https://api.cyclocity.fr/auth/environments/PRD/client_tokens
Content-Type: application/json

{
  "code": "vls.web.lyon:PRD",
  "key": "c3d9f5c22a9157a7cc7fe0e38269573bdd2f13ec48f867360ecdcbd35b196f87"
}
```

La paire ci-dessus est celle du JavaScript officiel collecté. La réponse directe est `200` avec `accessToken` et `refreshToken`. Le jeton reçu expire environ deux heures après son émission. Le renouvellement est déclaré par `POST /auth/access_tokens`, avec un corps `{"refreshToken":"..."}`. Ce renouvellement n'a pas été exécuté dans cette enquête.

Le payload du jeton applicatif est compressé avec zlib. Son en-tête annonce `zip: DEF`. Les claims observés sont `aud`, `exp`, `prm`, `sub` et `ver`. Il ne contient pas de `iat`. La durée restante a donc été obtenue à partir de `exp` et de l'heure de réception, sans supposer un JWT non compressé.

Sources locales dans [environment.js](sources/protocol-slices/environment.js), [application-token.js](sources/protocol-slices/application-token.js) et [vérification directe](evidence/live-verification.json).

### 2. Connecter l'utilisateur par OIDC et PKCE

La découverte actuelle est publiée à [openid-configuration](https://iam.cyclocity.fr/realms/vls-default/.well-known/openid-configuration).

| Fonction | Endpoint sous `https://iam.cyclocity.fr/realms/vls-default/protocol/openid-connect` |
| --- | --- |
| Afficher la connexion | `GET /auth` |
| Échanger le code ou renouveler les tokens | `POST /token` |
| Terminer la session | `/logout` |
| Informations d'identité | `/userinfo` |
| Clés publiques | `/certs` |

Les clients publics `vls-web-lyon`, `vls-ios-lyon` et `vls-android-lyon` affichent tous un formulaire de connexion lors des essais directs. La requête d'autorisation comporte les paramètres suivants.

```text
client_id=vls-ios-lyon
response_type=code
scope=openid email
redirect_uri=https://velov.grandlyon.com/openid_connect_login
code_challenge={BASE64URL_SHA256_CODE_VERIFIER}
code_challenge_method=S256
state={VALEUR_ALEATOIRE}
nonce={VALEUR_ALEATOIRE}
ui_locales=fr
```

Le parcours rapporté dans les captures est le suivant.

1. Afficher la page officielle de connexion et conserver le vérificateur PKCE, le `state` et le `nonce`.
2. Soumettre le formulaire officiel avec l'email et le code secret à six chiffres. Les URL d'action, cookies et champs de session sont produits par Keycloak.
3. Laisser le parcours d'identification de l'appareil se terminer. Les captures décrivent un formulaire `device_id` et des refus de connexion simultanée sur un autre appareil. Cette règle n'a pas été testée avec ton compte.
4. Récupérer le code dans le retour vers `/openid_connect_login`, puis vérifier strictement le callback et le `state` attendu.
5. Échanger le code contre les tokens personnels.

```http
POST https://iam.cyclocity.fr/realms/vls-default/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=vls-ios-lyon&redirect_uri=https%3A%2F%2Fvelov.grandlyon.com%2Fopenid_connect_login&code={CODE}&code_verifier={VERIFIER}
```

Le renouvellement personnel utilise `grant_type=refresh_token`, `client_id` et `refresh_token` sur le même endpoint. Les anciennes captures rapportent un access token de quinze minutes et un refresh token d'environ trente jours. Le test personnel du 28 octobre reçoit directement `expires_in: 1800`, soit trente minutes pour l'access token. La durée du refresh token et le renouvellement n'ont pas été vérifiés dans cet essai.

La découverte du realm mentionne aussi d'autres grants. Elle ne démontre pas que le grant `password` ou `client_credentials` est autorisé pour l'un de ces clients. Le parcours établi côté clients est Authorization Code avec PKCE.

### 3. Retrouver le compte et appeler l'API

```http
GET https://api.cyclocity.fr/contracts/lyon/accounts/{EMAIL_ENCODE_DANS_LE_CHEMIN}/id
Authorization: Taknv1 {CLIENT_TOKEN}
Identity: {KEYCLOAK_ACCESS_TOKEN}
Accept: application/json
```

Selon les captures, la réponse est une chaîne JSON contenant l'UUID du compte. Le code du site comporte la méthode `getAccountId` qui appelle cette route. Les exemples suivants utilisent cet UUID sous le nom `accountId`.

### Ce que cela implique pour ta propre application

| Forme de l'application | Conclusion étayée |
| --- | --- |
| Prototype natif personnel avec WebView | VLSKit contient un `LoginWebViewController` qui affiche Keycloak et intercepte le retour vers l'URL officielle. C'est une implémentation existante à examiner, pas une connexion reproduite ici. |
| Application native avec callback personnel et navigateur système | Le callback `my-velov://callback` testé avec le client iOS officiel reçoit `400`. Aucun enregistrement libre d'un nouveau client ou callback n'a été établi. |
| Application web sur ton propre domaine | Le callback local testé reçoit `400`. Le callback officiel revient sur le domaine Vélo'v. Un proxy HTTP seul ne fournit pas à ton site l'accès au code reçu sur cet autre domaine. |
| Intégration durable avec son propre client OIDC | Elle suppose une configuration acceptée par l'opérateur. Cette enquête ne contient pas de procédure publique pour obtenir cette configuration. |

Le code Swift est une piste de prototype, pas une garantie de compatibilité. Dans la version lue, `completeLogin` ne refuse le `state` que lorsqu'il est présent et différent. L'extraction du code contrôle le schéma et le domaine, sans contrôler le chemin complet. Une nouvelle implémentation doit exiger le `state` attendu et le callback complet, et gérer le renouvellement des tokens.

Sources dans [LoginWebViewController.swift](sources/vlskit/LoginWebViewController.swift), [AuthSession.swift](sources/vlskit/AuthSession.swift) et [AuthorizationRequest.swift](sources/vlskit/AuthorizationRequest.swift). Le [manifeste VLSKit](sources/vlskit-manifest.json) fixe les fichiers au commit lu.

## Les appels utiles à ton application

Les chemins ci-dessous sont relatifs à `https://api.cyclocity.fr/contracts/lyon`. Les routes de compte utilisent les deux en-têtes d'authentification décrits plus haut.

| Action | Méthode et chemin | Media-type principal | État de la preuve |
| --- | --- | --- | --- |
| Lire les stations | `GET /stations` ou `/stations/{number}` | `application/vnd.station.v4+json` | Une station vérifiée directement. |
| Lire les vélos d'une station | `GET /bikes?stationNumber={number}` | `application/vnd.bikes.v4+json`, mobile `v3` | Déclaré par le site. `403` dans les essais actuels. |
| Lire son profil | `GET /accounts/{accountId}` | `application/vnd.account.v4+json` | Site et captures. |
| Modifier son profil | `PATCH /accounts/{accountId}` | `application/vnd.account.v4+json` | Site et captures. |
| Lire les alertes du compte | `GET /accounts/{accountId}/alerts` | `application/vnd.account.v4+json` | Site et captures. |
| Lire ses abonnements | `GET /accounts/{accountId}/subscriptions?periods=CURRENT&typeList=ST&typeList=LT&isLocked=false` | `application/vnd.subscription.v6+json` | Site et interfaces Android rapportées. |
| Voir ses points | `GET /accounts/{accountId}/rewards` | `application/vnd.rewards.v5+json` | Site et captures. |
| Voir l'historique des points | `GET /accounts/{accountId}/rewards/history?page=0` | `application/vnd.rewards.v5+json` | Captures et Android rapportés. |
| Régler l'utilisation des points | `PATCH /accounts/{accountId}/rewards` | `application/vnd.rewards.v5+json` | Captures et Android rapportés. Corps `{"autoSpend":true}` ou `false`. |
| Lire les règles de fidélité | `GET /rewards/configurations` | `application/vnd.rewards.v5+json` | Vérifié directement. |
| Voir ses réservations | `GET /accounts/{accountId}/bookings` | Réponse rapportée `application/booking+json` | Captures et Android rapportés. |
| Réserver un vélo | `POST /accounts/{accountId}/bookings` | `application/json; charset=UTF-8` | Corps Android rapporté, succès non reproduit ici. |
| Libérer un vélo | `POST /accounts/{accountId}/subscriptions/{subscriptionId}/trips` | `application/vnd.trip.v6+json` | Capture réelle publiée et Android rapporté. |
| Suivre ses trajets en cours | `GET /accounts/{accountId}/trips/ongoing` | `application/vnd.trip.v6+json` | Captures et Android rapportés. |
| Consulter ses trajets passés | `GET /accounts/{accountId}/trips?status=FINISHED&status=ERROR&status=REVERSED` | `application/vnd.trip.v6+json` | Captures et Android rapportés. Le site déclare `v5`. |
| Noter le vélo d'un trajet | `POST /accounts/{accountId}/trips/{tripId}/rate` | `application/vnd.trip.v6+json` | Corps Android rapporté. |
| Lire ses statistiques | `GET /accounts/{accountId}/stats` | `application/vnd.stats.v1+json` | Site et captures. |
| Ajouter ou retirer une station favorite | `POST` ou `DELETE /accounts/{accountId}/stationbookmarks/{stationNumber}/` | `application/vnd.account.v4+json` | Site et captures. |
| Lire les offres et les groupes | `GET /offers`, `/offerGroups`, `/offerGroups/{groupId}/offers` | `application/vnd.offer.v2+json` | Site et captures. |
| Lire les offres accessibles au compte | `GET /accounts/{accountId}/offers` | `application/vnd.account.v4+json` | Site et captures. |
| Lire le moyen de paiement et sa validité | `GET /accounts/{accountId}/payment` | `application/vnd.payment.v3+json` | Site et captures. |
| Lire le solde financier | `GET /accounts/{accountId}/balance` | `application/vnd.balance.v1+json` | Site et captures. Distinct des points. |
| Consulter les ventes et transactions | `GET /accounts/{accountId}/sales`, `/transactions` | `application/vnd.sale.v1+json`, `application/vnd.transaction.v1+json` | Site et captures. |
| Obtenir un justificatif de transaction | `GET /accounts/{accountId}/transactions/{transactionId}/bill` | `application/vnd.transaction.v1+json` | Site et captures rapportées. |
| Obtenir un reçu d'abonnement | `POST /accounts/{accountId}/subscriptions/{subscriptionId}/periods/{periodId}/reports` | `application/json` | Capture rapportée. |
| Lancer une souscription ou une opération de compte | `POST /accounts/{accountId}/processes` | `application/vnd.processes.v2+json` | Site et captures, selon le type. |
| Reprendre un processus | `PATCH /accounts/{accountId}/processes/{processId}` | `application/vnd.processes.v2+json` | Déclaré par le site, parcours partiellement rapporté. |
| Échanger des points contre une invitation | `POST /accounts/{accountId}/rewards/consume/promocode`, puis processus de souscription | `application/vnd.rewards.v5+json` | Android rapporté. Le premier appel consomme les points. |
| Enregistrer un appareil pour les notifications | `POST /accounts/{accountId}/devices` | `application/vnd.message.v2+json` | Captures et Android rapportés. Corps avec plateforme et token push. |
| Lire les motifs de défaut | `GET /defect-type-groups?locale=fr&withDefectTypes=true` | `application/vnd.defect-type-group.v1+json` | Android et relevé communautaire. |

Les paramètres complets des statistiques, transactions et variantes sont dans la [référence communautaire](community-README.md). Le [catalogue structuré](catalogue-api.json) conserve les déclarations du site et les interfaces Android séparément.

### Voir les points

```http
GET /contracts/lyon/accounts/{accountId}/rewards
Authorization: Taknv1 {CLIENT_TOKEN}
Identity: {KEYCLOAK_ACCESS_TOKEN}
Accept: application/vnd.rewards.v5+json
```

La forme rapportée est un objet avec `balance`, `autoSpend`, `total` et `friendsInvitedCount`. Un compte sans historique de fidélité peut recevoir le code métier `rewards.exception.notfound.account`. Ce cas doit être distingué d'un autre `404`.

Les règles suivantes sont directement confirmées dans la configuration actuelle.

| Règle | Valeur | Activée |
| --- | --- | --- |
| `BIKE_BOOKING` | 10 points par réservation | Oui. |
| `RATE_BIKE` | 5 points pour une notation | Oui. |
| `START_STATION_FULL` | 10 points | Oui. |
| `END_STATION_EMPTY` | 10 points | Oui. |
| `PROMOCODE` | 50 points pour l'invitation prévue par ce mécanisme | Oui. |

Source dans [rewards-configurations.json](evidence/live/rewards-configurations.json). Ces règles ne prouvent pas que ton compte est éligible à chaque action.

### Réserver un vélo

```http
POST /contracts/lyon/accounts/{accountId}/bookings
Authorization: Taknv1 {CLIENT_TOKEN}
Identity: {KEYCLOAK_ACCESS_TOKEN}
Content-Type: application/json; charset=UTF-8

{
  "stationId": "{UUID_STATION}",
  "stationNumber": 0,
  "standNumber": 0,
  "subscriptionId": "{UUID_ABONNEMENT}",
  "bikeId": "{UUID_VELO}"
}
```

Les zéros et les chaînes entre accolades sont des emplacements à remplacer, pas des identifiants utilisables.

Le parcours Android rapporté vérifie le compte, le paiement, les points et l'abonnement. Il lit `BIKE_BOOKING` et `bike.booking.duration` avant de demander confirmation. Le serveur gère la consommation de points lors de la réservation. La configuration directement observée donne une durée de `900` secondes et un coût de `10` points.

`stationId` et `bikeId` sont des UUID. `stationNumber` et `standNumber` sont des numéros entiers. Le modèle de réponse rapporté comporte notamment `bikeId` et `endTime`. Son format exact en situation de succès n'a pas été capturé par cette enquête, et la référence communautaire marque aussi cette forme comme partiellement inférée.

Aucune méthode d'annulation n'est déclarée dans l'inventaire Android publié. Les parcours rapportés laissent la réservation expirer ou l'utilisent lors de la libération. Cela n'établit pas qu'aucune route d'annulation n'existe sur le serveur.

### Libérer un vélo

```http
POST /contracts/lyon/accounts/{accountId}/subscriptions/{subscriptionId}/trips
Authorization: Taknv1 {CLIENT_TOKEN}
Identity: {KEYCLOAK_ACCESS_TOKEN}
Content-Type: application/vnd.trip.v6+json

{
  "stationNumber": 0,
  "standNumber": 0,
  "bikeNumber": 0,
  "typeFrom": "SMARTPHONE"
}
```

Ici, `bikeNumber` est le numéro entier du vélo. La réservation utilise au contraire son UUID. Les données doivent correspondre au même vélo et au même point d'attache. L'abonnement doit être courant et autoriser la location.

La capture communautaire rapporte `200 {"transactionState":"OK"}`. Une réponse HTTP `200` ne suffit donc pas à établir la libération. Le client doit lire `transactionState`, afficher la consigne de retrait puis suivre `/trips/ongoing`. Le trajet peut ne pas apparaître si le vélo n'est pas retiré.

La configuration actuelle donne `bike.release.distance=200` et ne désactive pas le contrôle de géolocalisation. Un client personnel doit conserver ce contrôle de proximité avant de demander une libération. La restitution en borne est ensuite constatée par le système. Aucun appel de fin de trajet en borne n'a été établi dans cette enquête.

### Les autres actions passent souvent par un processus

Le moteur de processus utilise un corps `{"type":"...","parameters":{...}}` sur `/accounts/{accountId}/processes`.

| Type rapporté | Action |
| --- | --- |
| `SHORT_TERM_SUBSCRIPTION_V2` | Achat de ticket ou pass. |
| `LONG_TERM_SUBSCRIPTION_V2` | Souscription longue durée. |
| `MANUAL_RESUBSCRIPTION_V2` | Réabonnement. |
| `CHANGE_BADGE` | Changement de support. |
| `REGISTER_PAYMENT_METHOD` | Enregistrement d'un moyen de paiement à partir d'un checkout. |
| `CREATE_BIKE_DEFECT` | Signalement d'un défaut de vélo. |
| `SELFCARE_RETURNED_BIKE` | Demande concernant un vélo restitué. |
| `SELFCARE_TRIP_AMOUNT` | Contestation d'un montant de trajet. |
| `SELFCARE_RESCIND_SUBSCRIPTION` | Demande de résiliation. |
| `CREATE_SPONSORSHIP_PROMOCODE` | Parrainage. |
| `ACCOUNT_UNSUBSCRIBE` | Demande de suppression du compte. |

Ces types ne sont pas tous vérifiés au même niveau. Les paramètres et leur statut se trouvent aux sections 6 et 7 de la référence communautaire jointe. Les identifiants de certains processus utilisent une sérialisation telle que `<[Format : java.lang.Long]>123`, ou un préfixe `java.util.UUID`. Un JSON composé uniquement de nombres et de chaînes ordinaires n'est donc pas automatiquement équivalent à celui des clients officiels.

La réponse d'un processus doit être examinée pour `inError`, `error` et `toResume`, même lorsque le statut HTTP vaut `200`. Les paiements impliquent aussi le checkout et les éventuelles étapes 3-D Secure. Ils n'ont pas été exécutés dans cette enquête.

## Les vérifications directes et leurs limites

| Requête | Résultat du 28 octobre 2026 |
| --- | --- |
| Création du jeton applicatif web | `200`, deux tokens retournés, durée restante observée `7200` secondes. |
| Contrat Lyon | `200`. |
| Features Lyon | `200`. |
| Station 2002 | `200`, représentation `station.v4`. |
| Vélos de la station 2002 | `403`, page HTML Apache. |
| Règles de fidélité | `200`, représentation `rewards.v5`. |
| Découverte GBFS et disponibilités | `200`, sans jeton. |
| Autorisation OIDC avec callback officiel, trois clients | `200`, formulaire de connexion. |
| Autorisation OIDC web avec callback `http://127.0.0.1:8765/callback` | `400`. |
| Autorisation OIDC iOS avec callback `my-velov://callback` | `400`. |

Le refus de `/bikes` est reproduit avec les media-types mobiles `v3` et web `v4`. L'ajout des en-têtes `Content-Type`, `Origin` et `Referer` correspondant au site ne change pas le résultat. L'absence d'erreur métier JSON empêche d'attribuer ce refus à une règle de compte. La cause reste inconnue. Un essai depuis le parcours normal connecté sera nécessaire pour savoir si la route est utilisable dans les conditions prévues.

Ce refus empêche de valider ici la récupération actuelle des UUID et points d'attache des vélos. Les schémas de réservation et de libération sont identifiés, mais leur chaîne complète n'est pas démontrée avec ton compte.

Les features `overflow.enabled` et `trips.stopminute.activated` sont toutes deux inactives dans la configuration lue. Les fonctions Bluetooth d'arrêt minute et de station virtuelle décrites pour la plateforme ne sont donc pas des fonctions Lyon actives à promettre sur cette base.

Les réservations sont rapportées sous `status: RESERVED` ou `isReserved: true`. La variante `bikes.v4` est celle à considérer pour ce dernier champ. La lecture actuelle des vélos n'étant pas validée, cette distinction reste issue des captures et de la comparaison communautaire.

L'API privée n'est pas un contrat d'intégration publique garanti. La présence d'une route dans un client ne démontre ni son autorisation pour chaque compte ni son maintien futur. Pour une carte des stations et de leur disponibilité, le flux public directement vérifié est [GBFS Lyon](https://api.cyclocity.fr/contracts/lyon/gbfs/v3/gbfs.json).

## Où se trouvent les résultats

| Fichier | Contenu |
| --- | --- |
| [exemples-api.http](exemples-api.http) | Requêtes essentielles, avec valeurs personnelles laissées à remplir. Les requêtes de mutation sont séparées. |
| [catalogue-api.json](catalogue-api.json) | 97 entrées du registre web, dont 3 routes d'authentification applicative, et 89 déclarations Android rapportées. Ces dernières représentent 84 couples méthode et chemin distincts. |
| [cyclocity.community.openapi.yaml](sources/cyclocity.community.openapi.yaml) | Spécification communautaire importée, 74 opérations au commit collecté. Elle n'est pas entièrement vérifiée par cette enquête. |
| [cyclocity.community.postman_collection.json](sources/cyclocity.community.postman_collection.json) | Collection communautaire importée, 78 requêtes. Elle contient aussi des opérations de mutation, à sélectionner individuellement. |
| [community-README.md](community-README.md) | Référence détaillée originale de Yann Lombard, avec statuts de vérification par fonctionnalité. |
| [live-verification.json](evidence/live-verification.json) | Statuts HTTP et métadonnées des vérifications directes. Aucun token utilisable conservé. |
| [bikes-access-diagnostic.json](evidence/bikes-access-diagnostic.json) | Vérifications ciblées du refus d'accès aux vélos. |
| [web-manifest.json](sources/web-manifest.json) | URL et SHA-256 des 30 artefacts publics collectés, sans exécution. |
| [protocol-slices-provenance.json](evidence/protocol-slices-provenance.json) | Correspondance exacte entre les six extraits et les octets du bundle d'origine. |
| [rea-protocol-slices.json](evidence/rea-protocol-slices.json) | Analyse REA des extraits. |
| [decisions.tsv](decisions.tsv) | Choix d'enquête, échecs et limites. |

## Méthode et périmètre REA

Le skill utilisé est reverse-engineer-anything. Le workflow `poteto-mode` suit ici une investigation en lecture seule. Les sources distantes et l'application n'ont pas été modifiées. Les scripts et le présent dossier sont des artefacts locaux de recherche.

Le MCP REA n'était pas connecté. La voie CLI `rea-agents@6.7.0` a été utilisée sans modifier la configuration de Codex. Une première analyse du bundle complet a atteint le délai de trente secondes. Sa preuve partielle est conservée dans [rea-web-partial.json](evidence/rea-web-partial.json).

La seconde analyse porte sur six blocs JavaScript intacts, extraits avec leurs positions exactes dans le bundle. Elle réussit avec six fichiers parsés et zéro échec de parsing. Son Evidence ID est `ev_3835c80ea660e715d9de7e01f90d0d6fe5adbd30b6b7fb7313b76d9adf4f2f25`. Le graphe structurel est complet pour ces extraits. Le graphe sémantique reste partiel, notamment pour les appels dynamiques et les plafonds d'inconnues. Le code du site n'a pas été exécuté par REA. Cette analyse ne vaut pas décompilation de l'application mobile.

Les principes appliqués ont changé les choix suivants.

- **Model the Domain** a conduit à conserver séparément les déclarations web, les interfaces mobiles rapportées et les réponses HTTP, sans les fusionner en une liste présentée comme testée.
- **Build the Lever** a conduit à livrer les collecteurs, l'extraction avec provenance et le générateur de catalogue.
- **Prove It Works** a conduit à effectuer des requêtes sur les vrais serveurs et à garder le `403` comme résultat.
- **Attack the Premise** a conduit à vérifier la structure réelle du jeton après deux hypothèses erronées sur son format, puis à lire sa compression et son expiration correctement.

Les scripts sont `collect_web_artifacts.py`, `extract_protocol_slices.py`, `build_endpoint_catalogue.py`, `verify_public_api.py` et `diagnose_bikes_access.py`. Les deux derniers obtiennent uniquement un jeton applicatif public et font des lectures publiques ou affichent des pages de connexion sans identifiants. Ils n'effectuent pas de réservation, libération ou paiement. Les tokens obtenus restent en mémoire du processus.

Aucune suite de tests applicatifs n'a été exécutée. Le statut des tests applicatifs est `not tested`. Les vérifications réseau décrites et l'analyse statique ont été réellement exécutées. La relecture indépendante par sous-agent n'a pas été poursuivie après la demande d'arrêt de l'utilisateur.

## Sources et attribution

La documentation, l'OpenAPI, la collection Postman et l'inventaire Android de Yann Lombard proviennent de [cyclocity-api-doc](https://github.com/yannlombard/cyclocity-api-doc), commit `6126f71f63154f426a08f11b3dd712c2c607deb1`, daté du 25 octobre 2026. Leur licence est [CC-BY-4.0](sources/community-LICENSE). Leurs fichiers d'origine sont conservés. L'inventaire Android a été converti en JSON et ses chemins ont été complétés avec le préfixe Lyon. Ces transformations sont les seules adaptations de cet inventaire.

Le code Swift examiné provient de [Fyroeo/VLSKit](https://github.com/Fyroeo/VLSKit), commit `5fea3c62a541de8b0061755c17b76e612dcfa155`. Il est utilisé comme preuve d'une implémentation existante, sans compilation ni validation de bout en bout dans cette enquête.

Les sources officielles directement consultées sont le [site Vélo'v](https://velov.grandlyon.com/), son [bundle de protocole](https://velov.grandlyon.com/chunk-YDMXJULD.js), la [découverte OIDC](https://iam.cyclocity.fr/realms/vls-default/.well-known/openid-configuration) et les réponses des endpoints publics conservées dans `evidence/live/`.
