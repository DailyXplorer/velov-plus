# API notes

Facts about the Cyclocity API that Vélo’v+ relies on and that the [community documentation](api/community-README.md) does not carry. Unconfirmed request formats are in [api/hypotheses.md](api/hypotheses.md).

## Behaviour

- Release takes two steps (owner-confirmed): after `transactionState: OK` the bike stays locked; the user presses the physical button on the dock within about 60 s, then pulls the bike.
- Renewed tokens are written even on error responses; cookies are cleared only when Keycloak rejects the refresh token itself.
- A downstream 401 can be a stale app token: renew it and retry once, for reads only.
- Only the token, `accountId` and profile reads are fatal for the dashboard; the other reads degrade to warnings.
- Bike dates (`createdAt`, `lastTripDateTime`, `lastRevisionDateTime`, `lastControlDateTime`, `nextReview`) are UTC without a zone: append `Z`.
- `nextCheck` is a routine mark about 5 days after each control, so most bikes look overdue: flag only overruns of more than 30 days.
- Booking response: `endsAt` is UTC with a trailing `Z`.
- `GET /defect-type-groups` answers 403 to the web app token; the star rating needs no defect list.
- `PATCH /contracts/lyon/accounts/{id}` (`vnd.account.v4+json`) accepts `firstName`/`lastName` on a complete account (owner-verified from the site); names come back lowercase.
- Trip `litigious` is read-only: no known API declares a trip litigious (verify before relying on it).
- Bike recommendation (`lib/bike-score.ts`): recommend the best-scoring bike per type among bikes with at least 3 ratings and a value of at least 75 (filter first, then pick the max). The rating value is the mean of votes worth 100/60/30; low-count ratings are shrunk toward 70.

## Sessions and the one-device refusal

- A session exists only in the HttpOnly cookie of the browser that logged in (`lib/session.ts`) or in the iOS Keychain. Nothing is stored on Vercel.
- Every client (web, iOS, any new port) logs in as the Keycloak client `vls-web-lyon`. The official app’s client `vls-ios-lyon` enforces one device per account; `vls-web-lyon` lets the site and the app be logged in together (observed, not confirmed by the operator). When a new client hits the one-device refusal, check its client id first.
- In the Vercel logs, a login `409` on `/api/auth` is the `device` error: the account is bound to another device (verify against the route before relying on it).
- Likely cause of « déjà en cours d’utilisation sur un autre appareil » on the web: the random device id kept in the `vv_device` cookie (1 year) of the browser that logged in; logging in again from that browser reuses it.
- Logout POSTs `client_id` and `refresh_token` to the Keycloak logout and says when Vélo’v did not confirm. The device binding survives it.
- A password reset with « Se déconnecter des autres appareils » ends sessions but not the device binding.
- To free a device binding, in this order: « Se déconnecter » in the official app (closing the app is not enough); then the Keycloak account console `https://iam.cyclocity.fr/realms/vls-default/account/#/security/device-activity`, where the user logs in and chooses « Déconnecter tous les appareils »; then « Code secret oublié ? » on the login page; last, Vélo’v support (contact in the community documentation, `crc.phone` and `crc.mail.to`), asking to « fermer toutes les sessions et libérer l’appareil associé ».

## Geolocation settings

« Autour de moi » fails after Allow when the system blocks the browser. On macOS, Réglages Système › Confidentialité et sécurité › Service de localisation must list and enable that browser (each Chromium browser needs its own entry). On iPhone Safari, Service de localisation › Sites web Safari must be « Lorsque l’app est active » with Position exacte on.
