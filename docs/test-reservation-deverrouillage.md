# Test en station : réserver puis déverrouiller

Ces deux actions agissent sur votre vrai compte. La réservation coûte 10 points. Le déverrouillage démarre un trajet dès que le vélo quitte la borne. Le code n'a jamais envoyé ces requêtes : ce test est le premier.

## Avant de partir

- [ ] L'abonnement est en cours (onglet Compte).
- [ ] Vous avez au moins 10 points (onglet Points).
- [ ] Aucune réservation ni aucun trajet en cours.
- [ ] Le navigateur a le droit d'utiliser la position : la confirmation affiche alors la distance à la station.

## 1. Réserver

1. Devant une station, ouvrez « Voir les vélos », puis un vélo accroché à une borne et sans pastille « Réservé ».
2. Touchez « Réserver (15 min · 10 points) ».
3. Vérifiez la confirmation : station, borne, numéro du vélo, 10 points. Touchez « Confirmer », une seule fois.
4. Regardez l'écran de résultat :
   - Succès : « Vélo réservé jusqu'à HH:MM » et le compte à rebours. Le compte à rebours doit partir d'environ 15:00.
   - Échec : le message en français et la ligne grise du dessous.
5. Fermez la fiche : le bandeau « Réservé : vélo N, borne N, station X — reste mm:ss » apparaît en haut de l'app.

À noter : l'heure de fin (HH:MM) correspond-elle à maintenant + 15 min ? Une heure d'écart signale un problème de fuseau horaire.

## 2. Déverrouiller le vélo réservé

1. Dans le bandeau, touchez « Déverrouiller ». Vous pouvez aussi passer par la fiche du vélo.
2. Vérifiez la confirmation : borne, vélo et distance. Un avertissement apparaît au-delà de 200 m.
3. Mettez une main sur le vélo, puis touchez « Confirmer ».
4. Retirez le vélo dans les secondes qui suivent. Sinon, la borne le reverrouille et aucun trajet n'est créé.
5. Regardez l'écran de résultat :
   - Succès : « Vélo déverrouillé — borne N ».
   - Échec : le message et la ligne grise du dessous.

Vélo’v renvoie parfois `trips.exception.bookings.already.reserved` pour un vélo que l'on a soi-même réservé (observé le 22/10/2026). Si cela arrive, notez-le. Ne réessayez pas en boucle : choisissez un autre vélo, non réservé, et touchez « Déverrouiller » une fois.

## 3. Après

- [ ] Le bandeau de réservation a disparu.
- [ ] Après une dizaine de secondes et un « Actualiser », l'accueil affiche « Trajet en cours ».
- [ ] Le solde a baissé de 10 points (onglet Points, peut prendre un moment).

## À m'envoyer

- Une capture de chaque écran de résultat (réservation et déverrouillage). La ligne grise doit être lisible : `transactionState …`, `code …`, `HTTP …`, `endsAt …`, `trips/ongoing …`.
- L'heure de la réservation et l'heure de fin affichée.
- Le vélo s'est-il décroché ? Combien de secondes après « Confirmer » ?
- Tout message d'erreur rouge sous les boutons « Annuler / Confirmer ». Il contient le statut HTTP.

## Ce qui n'existe pas

Une réservation ne s'annule pas. Ni l'app officielle ni l'API documentée n'ont de route d'annulation. La réservation expire au bout de 15 min, ou se consomme quand vous déverrouillez le vélo.
