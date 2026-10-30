# Formats d’API non confirmés

Certaines requêtes de Vélo’v+ reposent sur des formats que personne n’a encore vérifiés par un envoi réel. Ils sont regroupés dans `lib/guesses.ts`, avec le niveau de confiance et la source de chacun ci-dessous. Ces constantes servent à corriger le format après vérification. Elles ne sont jamais des solutions de repli : en cas de refus, l’application n’essaie pas un autre corps ni un autre identifiant. Un format se change dans le code, après relecture, et la requête suivante part avec le nouveau format. C’est un choix produit : une fonction dont le format n’est pas documenté part avec la meilleure hypothèse plutôt que d’être grisée avec « Bientôt disponible », et elle ne porte aucun badge « Expérimental ».

Les sources sont la [documentation communautaire](community-README.md) et le client Swift [Fyroeo/VLSKit](https://github.com/Fyroeo/VLSKit/tree/5fea3c62a541de8b0061755c17b76e612dcfa155), lu au commit `5fea3c62`.

## Renouvellement automatique

Le corps de la requête porte le champ `isAutoRenewal`. La confiance est moyenne : VLSKit encode ce champ tel quel dans `Models/Subscription.swift`, lignes 203 à 211. La lecture `GET renewalDetails` suggère aussi les noms `autoRenewal` et `autoRenewalValue`, qui ne sont jamais envoyés. Le type de média `application/vnd.subscription.v6+json` est sûr : il figure dans le tableau Android de la documentation communautaire et dans `SubscriptionService.swift`, lignes 129 à 136.

## Prolongation en station pleine

Le type de média et le champ `stationId` sont connus avec une bonne confiance (documentation communautaire, § 5.5, et `SubscriptionService.swift`, lignes 93 à 116). La nature de l’identifiant reste incertaine : VLSKit le déclare comme un entier et suppose qu’il s’agit du numéro de la station, sans l’avoir vérifié. L’application envoie donc le numéro. Si Vélo’v attend l’UUID, il suffit de passer `VIA_STATION_IDENTIFIER` à `"uuid"`. La réponse attendue est l’état de transaction `OK`, sous forme de chaîne comme dans VLSKit ou dans un objet `transactionState`.

## Message au service client

Le message part en `multipart/form-data` avec les champs `complaintType` et `message`, ce que la documentation communautaire établit avec une bonne confiance (tableau du § 10). Les catégories `TRIP`, `SUBSCRIPTION`, `PAYMENT` et `PARKING` viennent de `EmailService.swift`, lignes 6 à 14, et restent moins sûres. Le champ `tripId` n’est pas envoyé, car VLSKit l’appelle `tripNumber` alors que le tableau de bord ne connaît que l’UUID du trajet. La référence du trajet choisi est ajoutée au texte du message. Le lien vers l’adresse e-mail du service client reste visible à côté du formulaire.

## Code à offrir à un ami

L’en-tête `Accept: application/vnd.rewards.v5+json`, le champ de réponse `promoCode` et la récompense `PROMOCODE` sont sûrs : ils figurent dans la documentation communautaire (§ 5.8 et § 7) et dans `RewardService.swift`, lignes 38 à 44. L’application s’arrête au code obtenu. Elle n’envoie aucun processus `SHORT_TERM_SUBSCRIPTION_V2`, car le parcours d’invitation et de paiement n’a jamais été exercé.
