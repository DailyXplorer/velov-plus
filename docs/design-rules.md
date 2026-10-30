# Design rules

These are the owner's product rules. They apply to the web app and the iOS app (velov-plus-ios) alike, unless a rule names one platform. Agents break the first section most often.

## Guardrails to restate in every UI brief

- Use red as the only accent colour. Never use pink, salmon or a tinted red box anywhere.
- Never use a black or ink surface. Neutral surfaces are mist or light grey.
- Never add a drop shadow (web or iOS). Separate surfaces with a 1px ink-line ring.
- Never show a focus ring, outline, hover ring or open state of any colour, on fields, selects or popovers (owner choice).
- Never show a check mark in an open menu or list. The selected option is simply red text.
- Never underline anything and never put a highlight behind a title.
- Never show an « Expérimental » badge. A feature whose request format is a best guess ships as a normal feature: one confirmation, one attempt, the French error message on failure.
- Never show a technical line to the user: no HTTP status, error code, `transactionState`, error name, elapsed time, browser, system or permission state, on any screen, dialog or toast. The technical detail goes to the technical journal only, which is the browser console on the web (`journal` in `lib/journal.ts`, one `console.warn` line per failure).

## Identity and type

- The product is « Vélo’v+ » (login title with a red « + », page and tab title, iOS display name and icon). Keep « Vélo’v » where the text means the official service (« Gérer sur Vélo’v », « Trajet Vélo’v »).
- Use two fonts only. Faculty Glyphic (derived « Velov Glyphic ») for titles and every big number (metrics, balances, records, countdown). DM Sans for everything else (buttons, labels, eyebrows, tags, chart axes, legends, small data). Never use Azeret Mono.
- « Velov Glyphic » is Faculty Glyphic with `one.tf` narrowed to the proportional width (the tabular « 1 » is 700 units wide and left a gap after every « 1 ») and U+202F added. The web loads it with `next/font/local`; `tools/make-number-font.py` builds it (fontTools, OFL). Every new numeric display uses it.
- Write buttons, eyebrows, card tags and small labels in UPPERCASE DM Sans (letter-spacing .02em), on web and iOS. Navigation labels are not uppercase.
- Give every quantity ≥ 1000 the French thousands separator on both platforms (not bike or station ids).
- Use icons from the free Hugeicons set only (stroke-rounded; `@hugeicons/react` and `@hugeicons/core-free-icons`), never Pro icons. The web mapping table is `components/icons.tsx`; iOS uses the same SVGs as template assets.
- Web `::selection` is white text on the red background, never ink on red. iOS selection is system-drawn.

## Colour and surfaces

- Fill every filled surface (nav tabs including mobile, summary cards, pins, arrow circles) with red #df2537 and white text and icons.
- Use red for surfaces and active states, not for big figures: balances and numbers are in ink (« Solde actuel » like « Total gagné »). Earned points (« +5 » rules, credited movements) are ink too; the « + » carries the meaning.
- Use one error colour, `--error` #b62938, for every error and warning text. Never use terracotta or brown text.
- Make an eyebrow pill on a mist card white, so it stays visible (Points « Solde actuel », « Total gagné »).
- Draw charts in red and mist/light grey only: the second donut segment is grey (never black), lines have no tinted area fill, empty heatmap cells are mist.
- Keep arrow circles visible on their background: white circle on red buttons, red outline on light ones.
- Make disabled buttons neutral grey (mist background, ink-soft text; outline variants grey text and grey ring), never red at reduced opacity, which reads as pink. On a mist card the disabled primary also gets the ink-line ring. Disabled ghost, icon and text buttons are ink at 30 %.
- Mobile bottom nav (web and iOS): black icons and labels, the active tab white on its red pill.

## Layout and components

- Harmonise, do not invent: the whole interface is the same everywhere. A new button or badge on a red surface reuses the summary-card pill (white pill, red circle with white icon, ink label); a circled icon on red reuses the white-ring circle of the card arrows.
- Give paired action buttons (Annuler/Confirmer, Réserver/Déverrouiller, form actions) identical width and height, hover background included: rows are a grid with `grid-auto-columns: minmax(120px, 1fr)` (1fr on phone), buttons `width: 100%`. Never size them by their text.
- Give every action button a leading Hugeicon like « Déverrouiller » (Réserver = timer, Obtenir un code = ticket, Modifier mes coordonnées = pencil, Envoyer = send, Les plus proches = location arrow, Écrire au service client = envelope). Dialog buttons (Annuler, Confirmer, Fermer, Vérifier, Retour, Continuer, Réessayer), « Voir les vélos » and « Itinéraire » stay text only.
- On phone (≤ 620 px) every control is 44 px tall (buttons, fields, select triggers, text links, disclosure summaries) and every icon button has a 44 px hit area. Screen, sheet and dialog side margins are 24 px.
- On phone, spacing follows the iOS scale: section gap 32, card gap 12, section title to content 16, content card padding 20, metric card padding 16.
- Station cards (map card, station sheet, selected station panel): « Voir les vélos » is the primary button, « Itinéraire » the secondary one, with no icon and a centred label; side by side they have equal width and a 12 px gap.
- No external-link arrow anywhere: « Itinéraire » and « Gérer sur Vélo’v » are text only.
- Every menu, select popover and search results list highlights a row (hover, keyboard, selected) with the same inset on the left and on the right: the card’s 6 px padding on both sides, never a reserved scrollbar gutter on one side. A menu that scrolls hides its own scrollbar (`scrollbar-width: none` and `::-webkit-scrollbar { display: none }`), because a classic scrollbar takes width inside the card on one side only.
- Login: « Continuer sans compte » sits 12 px under « Se connecter », the form’s normal gap. The login error appears in the flow between the two buttons (`role="alert"`) and reserves no space when there is none.
- A disclosure (`<details>`, such as « Certaines informations sont indisponibles ») keeps its caret even when it has a leading icon; the caret turns when it opens.
- Make select triggers and text fields look like the buttons beside them: pill shape, same height, white with the 1px ink-line ring (no grey fill, no shadow), chevron in a small mist circle.
- Web selects: a custom dropdown in the site style (white card, selected option in red text, no check mark, no focus or open ring on fields or triggers), never the OS-native menu.
- Drop a visible label that only repeats the control (« Afficher », « Trier par ») and keep it as `aria-label`. Keep labels where the value alone is ambiguous (Pays, Objet).
- Keep toolbars compact. The search is not a full-width bar; its filter sits inside the same pill at the right end (after the clear X, behind a thin divider), then « Autour de moi ». On phone the pill fills the row beside a round locate button and the filter shows a short label.
- Nothing shifts when a scrollbar appears or a window opens: `html { scrollbar-gutter: stable; }`, `.modal { scrollbar-gutter: stable both-edges; }` and `scrollbar-gutter: stable` on every own scroll container (bikes drawer, station sheet). Menus are excluded (select popover, search results overlay): they float over the page with a fixed width, so their own scrollbar shifts nothing around them, and a reserved gutter only makes the row highlight end further from the right edge than from the left. Check a new overlay or scroller with `getBoundingClientRect` before and after opening.
- Make loading skeletons pixel-faithful copies of the loaded layout (same wrapper classes, gaps, item count, heights, radii), in one single stage (never 3 cards then 6), with a neutral mist shimmer. Verify by measuring skeleton and loaded boxes in a preview route at 1280 and 390.
- Every tab opens scrolled to the top (tab click, browser back/forward). Never rebuild a tab on switch: every page stays mounted (hidden/opacity, or a persistent map host) so the Leaflet map and its pins are created once; scroll with `window.scrollTo`. Rebuilding recreates hundreds of pins and freezes on every switch.
- Desktop header: the page title's cap height starts on the same line as the top of the first sidebar tab pill (`.app-header` padding-top 29px / bottom 43px against the sidebar's 36px). Keep them aligned on every tab; measure with `getBoundingClientRect` and canvas font metrics, not by eye.
- Stat figures never float on the page: big numbers (Points Solde / Total gagné) sit in equal cards on the same surface and grid as the blocks around them (mist background, radius 16, side by side, full width), pill on top, number below.
- Text next to a big number must not look smaller: a two-line label beside a 56px number uses 28px lines (same total height), scaled with the number's breakpoints.
- Big figures carry no unit word when the label already says it (Points: « 540 », not « 540 points »; km, kg and € stay) and never overflow their card: `container-type: inline-size` on the card and `font-size: clamp(28px, 30cqi, 64px); white-space: nowrap` on the figure. Test 6-digit values at 390. Card pills and labels fit at 390 (« Distance », not « Distance estimée »).
- Short labels under figures never wrap: one word when an icon already says the rest (Mécaniques / Électriques / Places with the P icon, `white-space: nowrap`). Check uppercase labels at 1280 and 390.
- Give sibling cards in a grid parallel labels of similar length and structure (« Départ d’une station pleine », « Arrivée dans une station vide », « Évaluation d’un vélo après un trajet ») so they wrap to the same number of lines.
- Group compact count rows (station sheet, map card: icon and number, labels hidden) on the left with a fixed gap, never spread with `space-between`.
- Render drawers and modals (BikeDrawer, TripSheet…) as siblings after the styled containers, never inside a `<dl>` or card whose CSS uses descendant selectors (`.stat-records dt/dd`): the dialog is not portalled, so it inherits those rules and the same sheet looks different depending on where it opens. When a sheet looks different somewhere, grep where the component is mounted first.
- Give sticky headers inside drawers and sheets a z-index above any positioned child (`.card-tag` is `position: relative; z-index: 1`), or pills scroll over the title.
- Count any persistent banner (active booking) in fixed-height layouts and keep it compact (the Stations map uses `calc(100dvh - …)`), or the station sheet slides under the bottom nav.

## Guest mode

- Guest mode (« Continuer sans compte ») is the signed-in design with fewer features, on web and iOS: the same components, tokens, radii, margins and styles. A guest conditional only hides an account feature (other tabs, booking, unlock, account favourites sync, logout). It never changes layout or style, and there is no guest-only class or rule.
- Spacing that exists for a hidden feature is keyed on that feature, never on the mode. On the web the bottom padding that clears the phone tab bar applies under `.app-layout:has(> .mobile-navigation)`, so without the bar the Stations map keeps the same 12 px gap above the bottom edge that it keeps above the bar. Every page render sits in a `.page-slot` wrapper (guest page, signed-in pages and the signed-in loading skeleton), so every layout selector keyed on it matches all of them.
- A sign-in entry that replaces a hidden feature reuses the control it replaces. In the bike sheet, « Se connecter » is a button in the same `.bike-action-buttons` row as Réserver/Déverrouiller, shown only for a bike the signed-in sheet would offer. In the header, « Se connecter » takes the avatar's slot and tokens (mist fill, 40 px tall, 44 px on phone, red hover).
- Guest mode never makes an account call. An expired session and « Continuer sans compte » clear the session cookies locally (`POST /api/auth/forget`, no remote logout), so the next load opens the guest map instead of retrying the dead session. Every expiry also drops the bookings, the pending unlock and the « Trajet terminé » sheet.
- Prove it with guest and signed-in screenshot pairs at 390 and 1280 for each screen (Stations map with and without a card, station bikes, bike sheet, search, menus, header).

## Content

- Show no self-evident or all-is-well information. A bike listed in a station is obviously docked (show status only when unusual, such as maintenance); account flags (Actif, Complet, Valide) appear only when there is a problem; drop curiosity fields that do not help pick a bike.
- Add no explanatory text: no « à vol d’oiseau », no reason line under « Recommandé », no methodology notes in Statistiques, no bike type in the trip Live Activity.
- Lists stay compact: at most one badge per row (« Recommandé »), never the same label twice in a row; a bike to avoid is only greyed out, with no « À éviter » text.
- Bike sheet verdict: a round icon mark beside the bike number in the sheet title (`VerdictMark`: red circle and white thumbs-up for recommended, grey circle and warning for avoid; label as title/aria). Never put it next to the Mécanique/Électrique pill and never in a tinted callout listing reasons: the criteria stay internal.
- The owner’s own reservation is never a reason to avoid a bike: the bike sheet shows the booking instead of an « À éviter · Réservé » verdict (bike-score must know the booked bike number).
- Detail sheets: useful facts on top, secondary ones in a collapsed native `<details>` « Détails » (trip sheet: bike type, clickable bike number and « Déjà noté »). Optional lines (discount, points) render only when non-empty.
- A bike's « Prochain contrôle » in the past reads « En retard » with « Prévu le <date> » under it (`lateCheck` in `lib/bike-score.ts`), never « Il y a 18 j ».
- Show a litigious trip at once: its banner and the rate card stay visible, never inside « Détails ».
- The API has no trip distance: show the haversine between stations as « ≈ 600 m », with no « à vol d’oiseau » caption.
- Account: no account name in the sidebar (icon only); the avatar shows an icon while loading, never a placeholder letter.
- Show the Account tab’s logout button only on mobile (the sidebar has it on desktop), filled red with white text and icon, same on iOS.
- Never offer payment-method entry, plan or badge purchase: leave them to the official site.

## French copy

- Capitalise every segment that starts a line or follows a separator (« · », « — »): « Vélo 27619 · Borne 4 », « 91 avis · Le dernier il y a 4 h ». Lowercase only after « : » or mid-sentence. The UPPERCASE of buttons and labels stays.
- Write natural, short, idiomatic French, as SNCF Connect would: one idea per sentence, vouvoiement, no translated-English clause chains (« X, puis Y. Elle ne… »), « minutes » in sentences and « min » only in compact data. Drop caveats that do not prevent a costly mistake (« ne s’annule pas »).
- Write « peut-être » with a word joiner (U+2060) after the hyphen in every message, so it never breaks into « peut- / être ».
- Put a non-breaking space before ? ! : ; on the web as on iOS, and between a number and its unit (« 18 min », « 2 h », « 84 % », « 200 m » in a sentence). Distances from `formatDistance` keep a plain space, as on iOS.
- Show « Inactif » under a subscription without an end date only when it is inactive; never show « Actif ».
- Make section and card titles noun phrases, never sentences or bare enumerations (« Horaires de départ », « Répartition par type de vélo », « Temps à vélo par mois »). Put no subtitle or caption beside a title (« En minutes »): units belong on the axis.
- Action buttons and card titles carry no cost or duration (« Réserver », « Inviter un ami »). The cost appears only in the confirmation step, as the cost line alone.
- Unlock copy states the two steps: confirm on the phone, then press the dock button within 60 s and pull the bike.

## Confirmations and results

- Confirm once: a dialog shows only the question (plus one sentence if it prevents a costly mistake) and Annuler/Confirmer, with no before/after list, no restated balance (« Solde affiché : 540 points ») and nothing already on the page.
- On success the dialog closes itself and the page shows the new state: no success screen, no Fermer. Exception: results that are the information (the invite code).
- Show no inline success message either (« Merci ! +5 points » was removed): the Trajet terminé sheet closes itself after rating and the rating card just disappears.
- An unknown outcome (network error, timeout, 5xx) on a state-changing action shows the French error and « Le résultat est incertain : vérifiez avant de réessayer. », with only Annuler/Fermer. A clear refusal (4xx with a Vélo’v code) stays in the dialog with Annuler/Confirmer.
- The journal line of a failure (`technicalLine` in `lib/outcome.ts`: `transactionState`, HTTP status, code, detail; `describeLocationFailure` in `lib/geo.ts` for geolocation) omits a segment whose value is unknown (no « TransactionState — »). `runOnce` journals every failed state-changing action, `loadError` every failed load.
- The message of an uncertain action states only its cause (« Vélo’v ne répond pas. Le vélo est peut-être déverrouillé. »); the instruction appears once, in the uncertain note.
- A page or panel that cannot render at all (account, statistics, stations, bikes, a bike) shows the plain French message and « Réessayer » (`LoadFailure`), nothing else. Over a map it sits in a white ringed card with radius 16.
- Transient errors are one short French toast (`toaster.show` in `lib/toast.ts`, `<Toaster/>` mounted once in `app/layout.tsx`, so it exists signed out, as a guest and signed in): every geolocation failure, a failed refresh while data is on screen (the data stays, the toast says the refresh failed), and a failed action whose page stays usable and carries no uncertain outcome (receipt download, copying a code). Top right on desktop, top centre on phone (≤ 620 px, 24 px side margins); white card, 1px ink-line ring, radius 16, DM Sans 14 px in the error colour, an X « Fermer » (44 px hit area on phone); closes itself after 5 s; one at a time: a new message replaces the shown one and the same message only restarts the 5 s; `role="status"` so screen readers announce it. When a modal `<dialog>` is open, the toast renders inside it, because everything outside a modal dialog is inert, popovers included.
- Failures inside a confirmation dialog stay inline in the dialog (French message, uncertain note, Annuler/Fermer gating), and so does any failure with an uncertain outcome or one that gates a retry: book, unlock, rating, profile, favourites, auto-spend, auto-renewal, invite code, « 15 minutes de plus », contact, logout.
- Rating: five stars mapped onto the three stored levels (5–4 = recommended, rating `null`; 3–2 = 60; 1 = 30), one word per level (Parfait, Bien, Moyen, Décevant, À réparer), no defect picker. The buttons are a plain « Envoyer » (no « +5 points ») and « Plus tard » (remembered per trip).
- Offer the Trajet terminé sheet automatically when the ongoing trip disappears. On the web, poll a light ongoing-trip route every 20 s only while a trip is ongoing and the page is visible, one request in flight, stopping on finish or after 3 h. After an unlock the first sight of the trip reloads Accueil once, so the ongoing banner and « 15 minutes de plus » appear without Actualiser; a ride that starts and docks while the page is hidden still opens the sheet when the latest trip is the unlocked bike's, started after the unlock.
- First and last name are editable in « Modifier mes coordonnées » through the same account PATCH (`firstName`/`lastName`): send only changed fields, single attempt, French refusal in the dialog.
- Display names through `formatName` (French capitalisation, lowercase particles), including the form’s prefilled fields, because Vélo’v returns them lowercase. A name equal to `formatName(stored)` counts as unchanged and is not resent.

## Active booking banner

One slim line on solid red. The clock icon sits inside a 34px white-ring circle, followed by the countdown alone (no « Réservé » pill, no word « reste »; `aria-label` « Vélo réservé, N min restantes »), then « Déverrouiller » as the card pill: white pill, white lock icon in a 32px red circle (`.eyebrow-icon`), label in ink. The countdown is Faculty Glyphic with proportional digits inside a fixed min-width box. Bike, dock and station appear in the unlock confirmation instead.

The ongoing trip uses the same banner (`RedBanner`, `OnRedPill`) at the top of the overview: the bike icon in the white-ring circle, the elapsed time (« 06:00 », « 1:06:00 » from one hour), then « 15 minutes de plus » as the pill with the timer icon. Its `aria-label` is « Trajet en cours depuis N min ». It shows no « Trajet en cours » text and no station name.

## Maps

- Keep maps in colour: no grayscale filter on `.leaflet-tile-pane`.
- The web keeps standard OSM tiles because Apple Plans on the web (MapKit JS) needs the paid developer key; MapKit stays for iOS.
- CARTO basemap URLs now render « API KEY REQUIRED » tiles. Render any proposed free basemap once in a preview screenshot before proposing it.
- Stations tab: full-width map only, the pins are the list; search shows a small results overlay on the map. Maps sit in their own rounded card with the ink-line ring (like Overview).
- The web map wheel is cooperative (Google Maps embed pattern): Leaflet `scrollWheelZoom: true`, plus a capture-phase `wheel` listener on the map’s parent that calls `stopPropagation()` on plain wheels (the page scrolls and « Ctrl/⌘ + molette pour zoomer » flashes 1.2 s) and lets Ctrl/⌘ + wheel or trackpad pinch (`ctrlKey`) through. Verify with CDP `Input.dispatchMouseEvent type=mouseWheel`: scrollY moves and zoom is unchanged; with `modifiers=2` zoom changes.
- The map attribution (« Leaflet | © OpenStreetMap » on the web, the Apple « Plans » logo and « Mentions légales » on iOS) is never hidden or covered, and it is aligned with the floating card's edge, at the card's inset. On the web Leaflet's own control is off; `MapAttribution` sits in the map's `.map-foot` next to the card (`.map-station-card`, `.selected-station-panel`, `.station-sheet`), and the foot carries the card's inset (16/20 px on desktop, 12/22 px on the phone overview, 8 px on the phone Stations map). On desktop it sits bottom right, level with the card's bottom; on phone it sits 8 px above the full-width card, its right edge on the card's right edge. Without a card it keeps the same inset. Check with `getBoundingClientRect` at 390 and 1280, with and without a card: no overlap, same inset.
- Put overlays that cover the whole map (wheel hint, error veil) in the map’s positioned wrapper (`.overview-map` / `.explorer-map`) with a z-index above `.map-station-card` / `.station-sheet`, never inside the Leaflet element (`.station-map` has `z-index: 0`).
- Phone: on the Overview map the whole map is an invisible tap target to the Stations tab, with no « Toucher pour explorer » pill.
- Geolocation (« Autour de moi »): try `enableHighAccuracy: false` first (a Mac has no GPS; high accuracy alone often times out or returns code 2), retry once with high accuracy on codes 2 and 3 only, then show one French toast per code: 1 « Autorisez la localisation dans votre navigateur pour trouver les stations autour de vous. », 2 « Position introuvable pour le moment. », 3 « La localisation a pris trop de temps. Réessayez. », any other « Impossible de vous localiser pour le moment. ». The journal gets « Code · message · navigateur/système · Permission … ». The other « Autour de moi » and « Les plus proches » messages (insecure page, no geolocation, no open station for the filter) are toasts too.
- « Autour de moi » selects the nearest open station that has bikes, or free places under the « Places » filter (`nearestSupplied` in `lib/station-filter.ts`, same predicate as iOS), and fits the map to it and the next two.
- The user position is a white dot with a red ring and a neutral ink-line halo; the accuracy circle is neutral too, never red-tinted.
- When a filter leaves no station, a white pill over the map says « Aucune station pour ce filtre. » with the « Toutes les stations » link.

## Charts

- Chart tooltips (web and iOS): the card title always stays. The tooltip is a small white bubble (1px ink-line, no shadow) directly above the selected bar or cell column, centred on it with a 1px vertical guide down to the bar, in a band reserved permanently between title and plot (nothing jumps, it never covers a bar), clamped inside the card with its full text (shifted inward at the edges, the guide stays on the bar). Tapping elsewhere hides it. Verify with the first, middle and last bar selected at 390.
- Heatmap intensity (Horaires de départ): a red square inside each cell whose size follows the count; empty cells mist.
- The top y-axis tick carries the unit (« 800 min »); the other ticks are bare numbers.
- A selected donut segment changes colour: red-deep for Électrique, #d6cfcf for the grey segments.

## iOS adaptations

- iOS keeps the identity and adopts native behaviour (back button and swipe-back, native sheets and menus, haptics, 44 pt targets). Its rules live in velov-plus-ios `DECISIONS.md` and `docs/parity.md`.
- On iOS, menus follow the iOS style, with the list attached to its trigger.
- Replace a custom element with a native one only after the owner agrees.
