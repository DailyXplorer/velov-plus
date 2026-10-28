# Connexion et sessions

Le site et le client local utilisent des sessions distinctes. Vélo’v peut refuser une connexion lorsque le compte reste associé à un autre appareil.

## Client local

Depuis la racine du projet :

```sh
python3 tools/velov_connected.py status
python3 tools/velov_connected.py logout
```

La connexion initiale utilise `python3 tools/velov_connected.py login CHEMIN_DU_FICHIER_PRIVE`, avec le fichier fourni par la carte de secrets. Ce fichier est supprimé dès sa lecture. Les jetons personnels sont conservés dans le Trousseau macOS, hors du projet. Aucun code secret n’est enregistré.

`status` décrit uniquement la présence d’une session dans ce Trousseau. Le résultat `initial_login_required` ne prouve pas que toutes les sessions du compte sont fermées chez Vélo’v.

## Refus « autre appareil »

Le dernier contrôle local indique qu’aucune session de test n’est enregistrée dans le Trousseau. Le site a toutefois affiché un refus de connexion sur un autre appareil. La session distante qui produit ce refus n’a pas été identifiée.

Une correction conserve maintenant l’identifiant de l’appareil dans le navigateur même après un échec de connexion. Les tentatives suivantes réutilisent cet identifiant au lieu d’en créer un autre. Cet identifiant n’est pas un jeton de session.

Si le refus persiste, utiliser la commande **Se déconnecter** dans l’application Vélo’v officielle et dans les autres navigateurs où le compte pourrait être ouvert. Fermer une fenêtre ou quitter l’application ne garantit pas la fin de session. Si aucune de ces sessions n’est accessible, le service Vélo’v peut devoir libérer l’association.

Aucune nouvelle connexion personnelle, réservation ou libération de vélo n’a été effectuée pendant le rangement du projet et cette vérification.
