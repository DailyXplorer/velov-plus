# Development rules

Rules for anyone, human or coding agent, who changes this repo. Product and design rules are in [design-rules.md](design-rules.md); API facts are in [api-notes.md](api-notes.md).

## Safety with the real account

- Never send a state-changing call (book, unlock, rate, logout, profile, favourites, auto-spend, auto-renewal, invite code, contact, « 15 minutes de plus ») to the real Cyclocity API, never log into a real account, and never test a remote release, unless the owner explicitly approves that exact action, bike and station.
- An agent may only send the anonymous `client_tokens` POST and public GETs (stations, bikes of a station). Never type or store the owner’s credentials.
- Tests mock `fetch`. Every defect fix ships with a mocked test that fails before the fix and passes after it.
- Never force a logout of other sessions and never assume one device per account.
- The iOS app talks to Cyclocity directly, so there are no server logs: debug it from the on-device technical journal, never by logging into the account.
- Out of scope on purpose: payment methods (Worldline hosted page and 3-D Secure), buying or changing plans and badges (multi-step `processes` with payment), e-mail and password (Keycloak identity), account deletion (never).

## State-changing actions

- Keep the in-flight lock and the uncertain state of an action in the app-level store persisted per account (`lib/operations.ts`, `components/operations.ts`: localStorage plus a cross-tab lock), never in a per-component `useRef` or a `finally`-cleared flag: close-and-reopen would send twice.
- Acquire across tabs atomically: `navigator.locks` around check and write, and a unique operation id compared before clearing. `localStorage` plus `storage` events alone race.
- While a request is sending, block every way out, not only the visible arrow: Esc, backdrop click, X and browser back on the web; swipe-back, back button and sheet drag-to-dismiss on iOS.
- An uncertain unlock is checked automatically while its sheet is open, as on iOS: `pollUnlock` (`lib/bike-action.ts`) re-reads the ongoing trips 2, 5, 10, 15, 20, 30, 40, 50, 60 and 70 s after the send, then once at 2 minutes; a restored one resumes the remaining checks or checks once. Reads only, never a resend, and « Fermer » stays possible. The dock watch follows the uncertain unlock too.
- An uncertain operation offers no « Nouvelle demande » escape. One owner-approved exception: the support message keeps « Écrire un nouveau message » under « Votre premier message est peut-être déjà arrivé. », because no check exists and a duplicate message is harmless.
- Logout and account change bump a session generation, checked before any late response updates the UI or saves tokens (web and iOS). On the web the gate is one shared `sessionGate` (`lib/session-gate.ts`); every account read goes through `accountJson` (`components/get-json.ts`), which carries its signal, so a logout or login aborts the read before its refreshed cookies can land, and a read whose signal is already aborted sends nothing.
- Every server-side write to Cyclocity and every login, token, refresh and logout POST goes through `sendWrite` (`lib/write-transport.ts`): one fresh connection closed after the answer, never the pooled global `fetch`, because a reused connection can drop the request and undici's fetch resends a request after a 421. Reads keep `fetch`.
- Every read a write needs before it sends (session refresh, account id, app token, subscription, bike, station, rewards) runs inside `beforeSend` (`lib/session.ts`). Its failure is a certain refusal, « Vélo’v ne répond pas. Rien n’a été envoyé. » (HTTP 424, code `local.unavailable`); only an expired session still signs out. Only a failure of the write itself is uncertain.
- Booking and unlock name the account the page shows (`x-velov-account`, the SHA-256 of its e-mail). The route refuses a missing or different account before any upstream call, as a certain `local.account.changed` refusal, « Le compte a changé dans un autre onglet. Rechargez la page. », so a tab left on one account never starts a rental on another one signed in elsewhere.
- A new write route has `requireSameOrigin`, a session, a zod-validated body capped at 4 KB (`readJsonBody`), `maxDuration`, no retry (never `fetchTransient`), one request per confirmation, a mocked-fetch test, and the French failure message in its dialog. Its technical line (HTTP status, code, detail) goes to the journal through `runOnce`, never to the screen.
- When reviewing a diff, yours or another agent’s, grep it for retries added to state-changing calls before it ships.

## Repo conventions

- Write no code comments in either repo.
- Write READMEs and docs in natural French sentences (agent-facing rule files such as this one are in English). A README says what the project is, what it does, how it works (including the action safety rules), how to run, test and build it, links to the site and the sibling repo, and carries the unofficial-API disclaimer.
- Commit no scratch files, agent briefs or preview routes (`app/zz-preview`).
- Keep personal identifiers (device UDID, Apple team id, real name, absolute home paths, tokens) only in git-ignored local files, with a committed `.example` file next to them.
- Never put the owner’s real data in code, tests, docs or screenshots. Use placeholders (Jean Dupont, example addresses).
- Before publishing a repo or a branch, clone it fresh and grep the whole history (`git log --all -p`) and the commit author e-mails for names, e-mails, school, employer, address, phone numbers, home paths, device and team ids, JWTs and secret-like strings. Test numbers and the public Vélo’v support number are fine.
- Releases use annotated tags with a GitHub release. Each repo has a GitHub description, homepage and topics.
- After a repo rename, update the git remotes, the README cross-links and `package.json`.
- For parallel work on the same files, give each agent its own `git worktree` (`git worktree add ../velov-web-mobile -b <branch>`), merge, then `git worktree remove`. Never run `git add -A` or deploy from a tree another agent is editing.

## Parity with iOS

- Apply every content or design change on the web to the iOS app, and bring every iOS fix that applies to the web back to the web, in the same batch, with no pending follow-up list. Only Liquid Glass and the widgets are iOS-only.
- Port auth and protocol changes (client id, device handling) to iOS in the same pass.
- List intentional differences in velov-plus-ios `docs/parity.md`.

## Owner choices that override reviewers

These are intentional, not defects: no visible keyboard-focus indicator; fixed font sizes (no Dynamic Type scaling); a paid invite code stays displayed, with a copy button; navigation labels are not uppercase; Liquid Glass on iOS floating chrome.

## Local development

- Every UI brief restates the guardrails at the top of [design-rules.md](design-rules.md).
- Render every touched screen before calling a UI change done (iOS: `make snapshots`; web: a preview route and Playwright at 1280 and 390 px) and look at each PNG for detached or misaligned elements (the favourite star sits right after the station name, the X far right), wrong fonts, colours and wrapping.
- After a big batch of UI changes, run a full visual pass over every screen of both apps.
- When a fix lands in a shared component (one select, one button style), grep every call site and check each place it appears.
- To see a state that cannot be triggered safely (active booking, unlock result), add a throwaway client route `app/zz-preview/page.tsx` that renders the real component with fake props, run `npx next dev -p 3123`, and screenshot at 1280 px and at 390 px (mobile emulation, device scale 3) after removing the `nextjs-portal` dev overlay. Give each preview route a unique name. Before any deploy, stop the server and delete `app/zz-preview` and `.next/dev`: a stale `.next/dev` keeps a ghost route that breaks the build.
- If `tsc` fails on a route that only exists on another branch, run `rm -rf .next` (stale validator types).
- Next 16 allows one `next dev` per project directory: a second one exits with « Another next dev server is already running ». Reuse the running port or wait.
- A git worktree needs its own real `node_modules` (`npm ci`), not a symlink: Turbopack refuses files outside the project root. Otherwise build only after merging.
- Never ship a Content-Security-Policy change on a text-only test. Run `npm run build && npx next start -p <port>` with a throwaway route that renders the map and fonts, load `/` and that route in a browser with a `securitypolicyviolation` listener, and check zero violations, loaded Leaflet tiles (`.leaflet-tile-loaded` count) and loaded title and DM Sans fonts. A blocking CSP blanks the whole site.
- `next dev` and `next build` rewrite `next-env.d.ts`: run `git checkout next-env.d.ts` before committing.

## Deployment

- A hostname cannot contain « + »: the public host is `velovplus.vercel.app`.
- The old host `velov-compagnon.vercel.app` redirects (308) to `velovplus.vercel.app`, set with `PATCH https://api.vercel.com/v10/projects/<projectId>/domains/<old>?teamId=<teamId>` and `{redirect, redirectStatusCode: 308}`.
- Add a `*.vercel.app` domain with `POST https://api.vercel.com/v10/projects/<projectId>/domains?teamId=<teamId>` and `{name}`, using the Vercel CLI token; the ids are in `.vercel/project.json`. `vercel domains add` rejects vercel.app names, and `vercel alias set` pins one deployment, so the next deploy would not follow.
- Deploying from a folder without the `.vercel` link silently creates a new Vercel project named after the folder. Check that the printed URL starts with `velov-compagnon-`. Remove a stray project with `echo y | npx vercel project rm <name>` (`--yes` is not accepted).
- Session cookies are per host: after a host change users log in again.
- Deployment URLs are behind Vercel’s SSO (a plain `curl` gets a 302). Test a protected deployment with `vercel curl <path> --deployment <host>`.

## Review checklist

1. State-changing calls (book, unlock, rate, profile including names, favourites, auto-spend, auto-renewal, invite code, contact, « 15 minutes de plus », logout): can one be sent twice (double tap, close and reopen, back or swipe-back, two tabs or scenes, refresh or app killed mid-send, StrictMode, view re-creation, Task cancellation that still reaches the server)? Is any retried automatically? Is an unknown outcome (timeout, abort, 5xx, unreadable 2xx) kept uncertain until the real state is re-read, and never re-offered blindly? Can a lock stick forever, or release while the server may still receive the request? Check the shared operation registry (web `lib/operations.ts`, iOS counterpart) and the invite debit check.
2. Request volume and loops: dock-watch polling (cadence, back-off, foreground-only on iOS, 3 h cap, single in-flight), stats pagination (cap, cache, completeness flag), manual refresh throttle, effects or SwiftUI tasks that refetch too often, map and station loading on tab switches, upstream fan-out per route, caching.
3. Auth and session: web cookies and refresh, 401/403 handling, CSRF on `/api` routes, headers (CSP), secrets in client bundles or logs; iOS Keychain accessibility class, token refresh, nothing logged.
4. Parity: both apps behave the same on safety rules, French copy and design rules (single confirmation, no success screens, red and grey only, no shadows, uppercase DM Sans labels, Faculty Glyphic with proportional figures and French thousands separators). List every divergence.
5. Correctness against [api-notes.md](api-notes.md), then drawers, map, load failures, bugs, performance, dead code, and any personal data left in the repos or their history.

## Working rules

- Find bugs before the owner does: after every batch, run an autonomous QA pass that screenshots every page and state (guest and signed in, card open and closed, empty lists, errors, loading, phone and desktop), audits the critical flows in code (unlock, booking, trip end, login, network errors, journal) and adds a Codex co-review cross-checked with the Opus review.
- Fix what is found, review it, push and deploy without waiting for the owner; send a short report with one screenshot per changed page, for information.
- Only real-world actions need the owner's consent: a real unlock or booking (it starts a rental on the account), a payment, a message sent on the owner's behalf.
- Small feedback ships in 20-30 minutes; background cleanup runs separately and never blocks it.
