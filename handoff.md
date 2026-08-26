# HANDOFF — FitTrackr

_Last updated: 2026-08-26. Written as a handoff for the next engineer (or AI
session) picking this up. The user-facing feature list and setup instructions
live in [README.md](README.md); **this file is about intent, state, and sharp
edges** — the things you would otherwise have to rediscover by breaking
something._

## Goal

A self-hosted, privacy-first workout & training tracker for Steve Gee, run as
an installable PWA against his own Docker stack. Sibling project to
MacroTracker (same author, same stack choices, same server) — the two apps
are deliberately separate deployments that happen to share a parent domain,
which is the source of one of the sharper edges below (passkeys).

Design stance: real production app, not a toy — Postgres + Redis + JWT auth +
multi-user + admin panel. But it has **one real user**, so throughput and
horizontal scaling have never been a design constraint, and several places
assume a single API replica (noted below). AI features are **bring-your-own-key**
per user; no vendor key is ever baked in.

The primary use case that drives UX decisions: **logging a workout on a phone,
mid-set, one-handed, in a gym.** That is why the workout detail page has grown
collapsible exercises, oversized tap targets, a persistent timer, and
auto-collapse on completion. Anything that adds a tap to that flow is a
regression.

## How to run

```bash
cd D:\dev\FitTrackr
pnpm install
pnpm dev              # turbo: api on :4000, web on :3000
```

Requires a reachable Postgres + Redis (`DATABASE_URL`, `REDIS_URL`). For a
full local stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

| Command | Does |
|---|---|
| `pnpm dev` | turbo dev, all packages, hot reload |
| `pnpm build` | turbo build (api → dist, web → .next) |
| `pnpm db:migrate` | `prisma migrate dev` — **interactive, prompts for a name** |
| `pnpm db:push` | `prisma db push` — schema sync without a migration |
| `pnpm db:seed` | seed the exercise library |
| `pnpm db:studio` | Prisma Studio |

**Migration gotcha:** `pnpm db:migrate` is `migrate dev` and will sit there
asking for a migration name — it is for authoring migrations, not applying
them. To apply existing migrations to a deployed DB use
`cd packages/api && npx prisma migrate deploy`. In practice you rarely need
to: see "Deployment" below, the container migrates itself on boot.

## Deployment

Docker Hub images built by GitHub Actions (`.github/workflows/docker-publish.yml`)
on every push to `main`: `geaves006/fittrackr-api` and
`geaves006/fittrackr-web`, tags `latest` + branch + sha + semver on `v*` tags.
Build matrix targets the `production` stage of each Dockerfile, GHA layer cache.

Runs as a **Portainer stack** — db, redis, api, web. "Pull and redeploy" in
Portainer is the entire update procedure.

**The live stack was NOT deployed from `docker-compose.portainer.yml`.** That
file sets `container_name: fittrackr-api` etc., but the running containers are
named `fittrackr-api-1` / `fittrackr-web-1` / `fittrackr-db-1` /
`fittrackr-redis-1` — the Compose-generated `<project>-<service>-<n>` form,
i.e. it came from the README's compose block. This matters the moment you go
looking for logs: `docker logs fittrackr-api` returns
`No such container`, and if you pipe it through `grep 2>&1` the daemon's error
gets swallowed and it looks like an empty log rather than a wrong name. Always
confirm the name first:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | grep -i fit
```

Logs are raw JSON pino in production (`pino-pretty` only outside production),
so errors are `"level":50`:

```bash
docker logs fittrackr-api-1 --since 30m 2>&1 | grep '"level":50' | tail -20
```

**`packages/api/docker-entrypoint.sh` runs the migrations itself on every
container start** (`prisma migrate deploy`), so a redeploy applies pending
migrations with no manual step. See sharp edge #1 — its failure handling is
dangerous and you should know about it before you trust it.

## Architecture

pnpm 10 workspaces + Turborepo. ESM throughout on the API side (`"type":
"module"`, so **relative imports must carry a `.js` extension** even in
TypeScript source).

| Package | Role |
|---|---|
| `packages/shared` (`@fittrackr/shared`) | Types, Zod schemas, constants. Imported by both api and web — **the contract**. Changing a schema here changes validation on the server and types on the client at once. |
| `packages/api` (`@fittrackr/api`) | Fastify 5 + Prisma 6, port 4000, prefix `/api/v1`. |
| `packages/web` (`@fittrackr/web`) | Next.js 15 App Router + React 19 + Tailwind 4 + TanStack Query v5, port 3000. |

### API layout — `packages/api/src`

`index.ts` → `buildApp()` in `app.ts` → `seedExercisesIfEmpty()` → listen on
`0.0.0.0:API_PORT`. Fastify is created with `trustProxy: true`.

Registration order in `app.ts`: cors → cookie → helmet
(`contentSecurityPolicy: false`, "CSP managed by Next.js") → rate-limit
(global 100/min) → prisma → redis → auth. Then every route inside one
encapsulated plugin at prefix `/api/v1`. Unprefixed: `GET /health`,
`GET /health/ready` (pings Postgres + Redis).

**Error handler** (`app.ts:50`) is the single funnel: `AppError` subclasses →
their own status + `{error:{code,message,details}}`; `ZodError` → **422**
`VALIDATION_ERROR` with `flatten().fieldErrors`; anything else → 500
`INTERNAL_ERROR`. Throw typed errors from `utils/errors.ts`
(`ValidationError` / `UnauthorizedError` / `ForbiddenError` / `NotFoundError` /
`ConflictError`) and the shape takes care of itself.

**Plugins** (all `fastify-plugin`-wrapped): `prisma.ts` (module-level
singleton client), `redis.ts` (ioredis), `auth.ts` (`@fastify/jwt` HS256,
**15 min** access tokens, decorates `fastify.authenticate`).

Routes: `auth/{index,oauth,passkey,sso}`, `users`, `exercises/{index,preferences}`,
`workouts/{index,import}`, `workout-templates`, `programs`, `training-goals`,
`personal-records`, `measurements`, `progress-photos`, `admin`.

Services (`src/services/`) hold the business logic; routes are thin. Notable
ones: `ai-provider.service.ts` (provider-agnostic AI façade),
`passkey.service.ts` (WebAuthn), `workout.service.ts` (sets, ordering, volume
aggregates), `personal-record.service.ts` (1RM + PR upserts),
`csv-import.service.ts`, `seed.service.ts`, `wger.service.ts` (exercise
lookup with 24 h Redis cache, fails soft).

### Data model — `packages/api/prisma/schema.prisma`

Postgres, all PKs `uuid @db.Uuid`, snake_case via `@map`/`@@map`. Models:
`User` (+ `UserProfile`, `UserSettings` 1-1), `Passkey`, `BodyMeasurement`,
`ProgressPhoto`, `Exercise`, `Workout`, `WorkoutSet`, `WorkoutTemplate`,
`Program`, `TrainingGoal`, `PersonalRecord`, `SsoProvider`, `AppConfig`,
`ExercisePreference`.

Key invariants — the non-obvious ones:

- **`Workout.exerciseOrder` is a denormalized `String[]` of exercise IDs**,
  maintained in application code only. `addSet` appends an ID if absent;
  **nothing ever removes one**, so the array drifts and can name exercises
  with zero remaining sets. The frontend defends against this by intersecting
  the saved order with the exercises that actually have sets, then appending
  any unlisted ones — keep that defence if you touch the ordering code.
- **`WorkoutSet.supersetGroupId` is a bare UUID with no FK** — it is a
  grouping token, not a relation. "All members belong to the same workout" is
  enforced only by the route handler.
- **`PersonalRecord` is unique on `(userId, exerciseId, recordType)`** — one
  row per record type, overwritten in place. **There is no PR history.**
  `setId` is another FK-less UUID and dangles once the source set is deleted;
  PRs are never recomputed on set update/delete.
- **`WorkoutSet.exerciseId` and `PersonalRecord.exerciseId` do NOT cascade** —
  an exercise referenced by any set cannot be deleted. That is why the admin
  panel got a *rename* rather than a delete-and-recreate flow for fixing
  typos in manually-added exercises.
- **`ProgressPhoto.filePath` stores ciphertext**, not a path — so it is not
  queryable or sortable, and it is unrecoverable if `ENCRYPTION_KEY` changes.
- **`WorkoutTemplate` has no FK/relation to `User`** at all — just a plain
  `userId` column. Scoping is manual `where: { userId }` in every query, and
  templates are *not* cascade-deleted with the user.
- `Exercise.createdBy` is `SetNull`, so custom exercises survive user deletion
  as `isCustom: true, createdByUserId: null`.
- **`Passkey.counter` is `BigInt`** — convert at every boundary; it is not
  JSON-serializable by default.
- `AppConfig` is a generic KV table keyed by `key` (the PK is the string).

### Migrations

Manually numbered, **not** Prisma's timestamp convention:

| Migration | Does |
|---|---|
| `0001_init` | Baseline: 13 enums, 15 tables, all indexes and FKs |
| `0002_exercise_preferences` | `exercise_preferences` table (rep ranges, target sets per user+exercise) |
| `0003_superset_group_id` | `workout_sets.superset_group_id UUID` nullable, no FK |
| `0004_set_is_completed` | `workout_sets.is_completed BOOLEAN NOT NULL DEFAULT false` |
| `0005_workout_exercise_order` | `workouts.exercise_order TEXT[] NOT NULL DEFAULT '{}'` |

Because the names are hand-numbered, **any migration you create with
`prisma migrate dev` will get a timestamp name and sort after all of these** —
the convention breaks the moment you use the tool normally. Decide
deliberately: either keep hand-numbering (`0006_…`) or accept the mix.

### Auth

Three separate mechanisms, all landing on the same `User` row.

**Access tokens** — `@fastify/jwt`, HS256, `JWT_SECRET`, **15 minutes**,
payload `{ sub, email, isAdmin }`. `fastify.authenticate` verifies.

**Refresh tokens are NOT JWTs.** `auth.service.ts` mints
`crypto.randomBytes(48).toString('hex')`, SHA-256 hashes it, and stores
`refresh:<sha256> → userId` in Redis with a **7-day** TTL (**30 days** with
`rememberMe`). Refresh **rotates**: the old key is deleted and a new pair
issued. Logout deletes the key. Passwords are bcrypt cost 12.
Consequence: **`JWT_REFRESH_SECRET` is required by config validation but is
never read by any code** (sharp edge #23).

**Redirect-flow handoff** — Google OAuth and SSO never put tokens in the URL.
`createAuthCode` stores `authcode:<hex> → {accessToken, refreshToken}` in
Redis for **60 s, single use**, redirects to
`${FRONTEND_URL}/oauth-callback?code=…`, and the SPA calls
`POST /auth/exchange-code`.

**First-user-is-admin**, plus a **retroactive promotion**: if no admin exists
at all, the oldest user by `createdAt` is promoted — this logic is
copy-pasted in both `loginUser` and `refreshTokens`. Deleting your last admin
silently hands admin to whoever registered first.

**Signup gating** via `AppConfig.signups_enabled`, but SAML and OIDC logins
are **deliberately exempt** ("authenticated by a trusted identity provider").

**Passkeys / WebAuthn** — `@simplewebauthn/server` v13,
`services/passkey.service.ts`. `residentKey: 'preferred'`,
`userVerification: 'preferred'`, `attestationType: 'none'`, registration
passes `excludeCredentials`. The client origin is stored next to the challenge
in Redis so verification recomputes an identical rpID/origin.

**rpID is the FULL hostname** (`new URL(origin).hostname`), deliberately —
see the incident in sharp edges. `getClientOrigin(request)` derives it from
the `Origin` header with a `Referer` fallback.

**Redis keys** (Redis is the only ephemeral store — no session store, no
distributed rate limiter):

| Key | TTL | Purpose |
|---|---|---|
| `refresh:<sha256>` | 7 d / 30 d | refresh token → userId |
| `authcode:<hex>` | 60 s | OAuth/SSO token handoff |
| `webauthn:reg:<userId>` | 300 s | passkey registration challenge + origin |
| `webauthn:auth:<challenge>` | 300 s | passkey auth challenge + origin |
| `sso:state:<state>` | 300 s | OIDC state + nonce |
| `wger:search:v1:*`, `wger:exercise:v1:*` | 24 h | wger.de response cache |

### AI

Three providers, chosen **per user** (`UserSettings.aiProvider`): OpenAI,
Anthropic, Gemini. Keys are per-user, encrypted at rest, never global. SDKs
are **dynamically `import()`ed inside each call**, so a missing SDK is a 502
at request time rather than a boot failure.

`services/ai-provider.service.ts` is the only place that talks to a provider.
It resolves + decrypts the key for the user's chosen provider, maps a **tier**
to a concrete model, and normalizes errors.

| tier | OPENAI | ANTHROPIC | GEMINI |
|---|---|---|---|
| `light` | `gpt-4o-mini` | `claude-haiku-4-5-20251001` | `gemini-2.0-flash` |
| `heavy` | `gpt-4o` | `claude-sonnet-4-6` | `gemini-2.5-pro` |
| `vision` | `gpt-4o` | `claude-sonnet-4-6` | `gemini-2.0-flash` |

Entry points: `aiChatCompletion` (default `light`), `aiVisionCompletion`
(default `vision`), `aiPdfCompletion` (**Anthropic-only**, hardcoded to
Anthropic `heavy`, maxTokens 32000, throws 400 `PDF_NOT_SUPPORTED` otherwise).
JSON is forced per-provider (OpenAI `response_format`, Gemini
`responseMimeType`, Anthropic by appending a "respond ONLY with valid JSON"
instruction), then everything passes through `stripCodeFences()`. Timeouts
120 s / 180 s for PDF.

Tier call sites: `light` — exercise ai-suggest, training-goal generation.
`heavy` — workout ai-generate, program generation. `vision` — workout
ai-import (screenshots), exercise ingest.

**Encryption** — `utils/encryption.ts`: AES-256-GCM, key =
`Buffer.from(ENCRYPTION_KEY, 'hex')` (hence the 64-hex-char validation),
random 16-byte IV, format `base64(iv):base64(tag):base64(ciphertext)`. The
same primitive protects user API keys, SSO secrets, and progress-photo paths —
**one key, three blast radii.**

### Environment variables

Validated by Zod in `packages/api/src/config/env.ts`, which logs field errors
and `process.exit(1)` **at import time** if anything is missing.

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **yes** | |
| `JWT_SECRET` | **yes** | min 32 chars |
| `JWT_REFRESH_SECRET` | **yes** | min 32 chars — **validated, never used** |
| `ENCRYPTION_KEY` | **yes** | min 64 chars (32-byte hex) |
| `NODE_ENV` | no | def `development` |
| `API_PORT` | no | def 4000 |
| `REDIS_URL` | no | def `redis://localhost:6379` |
| `FRONTEND_URL` | no | def `http://localhost:3000`; drives CORS + OAuth redirects |
| `API_BASE_URL` | no | def `http://localhost:4000`; drives OAuth/SSO callback URLs |
| `GOOGLE_CLIENT_ID` / `_SECRET` | no | both required together or the whole OAuth plugin no-ops |
| `USDA_FDC_API_KEY` | no | **MacroTracker leftover — no consumer in this repo** |

**`DATA_DIR` bypasses the schema entirely** — read straight from
`process.env` in `progress-photo.service.ts` with a `'./data'` fallback, and
it is in neither `env.ts` nor `.env.example`. A typo silently writes progress
photos to a relative directory that is lost on container restart unless
volume-mounted. Frontend uses `NEXT_PUBLIC_API_URL`.

### Web layout — `packages/web/src`

Next.js 15 App Router, `output: 'standalone'`, path alias `@/*` → `./src/*`,
`transpilePackages` for `@fittrackr/shared`. **Practically the entire app is
`'use client'`** — only `Card.tsx` and the `(auth)` layout are server
components, so none of the RSC/streaming benefits of the App Router are in
play. Treat it as an SPA that happens to be built with Next.

Provider nesting in `app/layout.tsx`: `ThemeProvider > QueryProvider >
AuthProvider`.

| URL | Purpose |
|---|---|
| `/` | Client redirect gate → `/dashboard` or `/login` |
| `/login`, `/register`, `/change-password` | Auth. Login fetches `GET /auth/providers` unauthenticated to decide which methods to offer |
| `/oauth-callback` | Exchanges `?code` for tokens (see auth-code handoff above). `Suspense`-wrapped for `useSearchParams`; a `processed` ref guards double-run |
| `/dashboard` | Volume rings, streak, undertrained muscles (<50% of weekly target), this-week list |
| `/workouts` | Month calendar + list, quick-start by type, AI generate, AI import |
| `/workouts/[id]` | **The workout logger** — the heart of the app, see below |
| `/trends` | Hand-rolled SVG charts; week-vs-prev volume, 30 d body measurements |
| `/programs` | AI program CRUD + materialize a program day into a real workout |
| `/profile` | 4 tabs: Bio, Photos, Security, Settings. **1956 lines** — largest file in the repo |
| `/admin` | Admin-only, 5 tabs: stats, users, exercises (+ AI ingest), SSO, settings |
| `/exercises`, `/training-goals`, `/import` | **Orphan routes — no nav entry.** Reachable only by URL or a tutorial `router.push` |
| `/api/config` | The only route handler. Returns `{ apiUrl }`. **Unused** — `api-client` derives the URL itself |

Nav is driven from one source of truth, `components/layout/nav-items.ts`
(Workouts, Trends, Home, Programs, Profile) — `BottomNav` renders the middle
item as a raised FAB; `SidebarNav` is the `lg+` counterpart.

### Frontend auth & networking — the part to read first

`src/lib/api-client.ts` is the entire networking layer. No generated client,
no response validation (`zod` is a declared dependency and **unused**).

- **The access token lives in a module-level `let accessToken` variable** —
  never persisted, so it is lost on every reload.
- **The refresh token lives in `localStorage['refreshToken']`** — XSS-exposed;
  there is no httpOnly-cookie option.
- On mount `AuthProvider` reads the stored refresh token, calls
  `POST /auth/refresh`, sets both, then `GET /users/me`. **A cold PWA launch
  therefore always requires network before anything renders.**
- Refresh is **reactive only** — on mount, or on a 401. No scheduled refresh.
- `apiFetch` sets `Content-Type: application/json` **only when a body
  exists** — deliberate, to avoid Fastify empty-body JSON parse errors. Don't
  "clean that up".
- `deriveApiUrl()` order: `NEXT_PUBLIC_API_URL` → a hostname heuristic
  (`fit.geehive.com` → `fit-api.geehive.com`) → `http://localhost:4000/api/v1`.
  `NEXT_PUBLIC_*` is **inlined at build time**, so changing it at runtime in
  the container does nothing — which is presumably why the unused
  `/api/config` route exists.
- On 401 with an access token present it refreshes and **retries once.**
  Three sharp edges live here — see #33–35.

### The workout logger — `app/(dashboard)/workouts/[id]/page.tsx`

854 lines and the most-iterated screen in the app. Everything here exists
because the author hit it in a gym.

- Data is one `useQuery(['workout', id])` returning a flat `sets[]`; the page
  groups it client-side into a `byExercise` Map (warmups first, then
  `setNumber`).
- **Supersets/circuits**: sets carry `supersetGroupId`; the page derives
  `supersetGroupMap`/`exerciseToGroup` and renders ordered `Slot`s
  (`single` | `group`). "Link mode" (`linkingExerciseId`) pairs two exercises.
  Badge color is a hash of `groupId` over a 4-color palette.
- **Ordering** reads server-persisted `workout.exerciseOrder`, intersected
  with exercises that actually have sets, then appends any unlisted ones (the
  defence against the append-only drift noted above). `moveSlot` ↑/↓ →
  `PATCH /workouts/:id/exercise-order`.
- **Auto-collapse is three-state**: `isKeyCollapsed` = explicit
  `collapsedKeys` ∪ (all working sets complete) − `userExpandedKeys`. Two Sets
  are needed so a manual gesture always beats the auto-detection, in both
  directions. Don't collapse this into one boolean.
- **Add-set prefill** reuses the previous set's weight/reps, else
  `GET /exercises/:id/last-set?excludeWorkoutId=`. The warmup ladder
  (40%×8, 60%×5, 75%×3) fires **three sequential POSTs with no batching and
  no rollback on partial failure.**
- **Cardio is inferred client-side**, not stored: the `cardioExercises` Set is
  populated when any set already has `durationSec`/`distanceM`, and it only
  recomputes on `workout?.id` change — so **a brand-new cardio exercise
  renders strength inputs until reload.** Known limitation; the honest fix is
  a flag on `Exercise` or reading `category === 'CARDIO'`.
- **The stopwatch** is wall-clock-anchored (`startAnchorRef`) and persisted to
  `localStorage['fittrackr:timer:<workoutId>']` as
  `{ anchor, isRunning, pausedElapsed }` so it survives navigation,
  backgrounding, and reload. `elapsed = (Date.now() - anchor)/1000`. Finish
  and Delete both clear it.
- Rest-timer auto-start uses a monotonically incrementing `restTimerTrigger`
  counter passed as a prop (trigger-by-value-change).

**`components/workout/SetRow.tsx`** — each field is a local controlled string,
`useEffect`-synced from props, committed **on blur** via
`PATCH /workouts/:id/sets/:setId`. kg is canonical; imperial is display-only
conversion. Completing a set commits every field and *then* fires a separate
`isCompleted: true` PATCH — **one tap can issue 3–4 sequential PATCHes, each
invalidating `['workout', id]`.**

**There are no optimistic updates anywhere in the app** — zero `onMutate` /
`setQueryData` / `cancelQueries`. Every mutation is fire-then-
`invalidateQueries`, so the logger visibly round-trips on every commit and
every checkbox. On a phone on gym wifi this is the single biggest UX problem
in the product.

### Other frontend notes

**PWA** — `withSerwistInit` in `next.config.ts`, `src/sw.ts` uses the stock
`defaultCache`: `skipWaiting`, `clientsClaim`, `navigationPreload`.
**Disabled in development.** No custom API caching, no background sync, no
offline fallback page, no query persistence, no mutation queue, no
`navigator.onLine` handling. Combined with the memory-only access token,
**"works offline" in the README means "assets are precached", nothing more.**

Icons and the 14 portrait iOS splash screens are generated by
**`generate-icons.mjs` at the repo root, run by hand** (`node generate-icons.mjs`)
— it is wired into no npm script and hardcodes a machine-specific sharp
fallback path. The splash design deliberately paints the barbell directly on
`#030712` with **no rounded-rect container** (matching MacroTracker's style,
commit `fbc5ec1`). `apple-mobile-web-app-capable` is hand-written in `<head>`
because Next only emits the modern `mobile-web-app-capable`.

**Tailwind 4 is configured entirely in CSS** — there is **no
`tailwind.config.*`**. `src/app/globals.css` (39 lines) is the whole theme
layer: `@import "tailwindcss"`, `@custom-variant dark (&:where(.dark, .dark *))`
(class-based dark, which is what `ThemeProvider` drives), five safe-area
`@utility` helpers, and a `max-width: 639px` rule forcing
`input/select/textarea { font-size: 16px !important }` to stop iOS Safari's
focus-zoom. **There is no `@theme` block and no design tokens** — every color
is a stock Tailwind palette name hardcoded per component, plus raw hex in the
SVG components.

**localStorage keys** (complete):

| Key | Contents |
|---|---|
| `refreshToken` | Raw refresh token, rotated on every refresh |
| `fittrackr-dark-mode` | `"true"`/`"false"` |
| `fittrackr_rest_seconds` | Default rest duration |
| `fittrackr_plate_config` | `PlateConfig` JSON (bars, plates per unit) |
| `FitTrackr-tutorial-complete` | `"true"` once the 13-step tour is done |
| `fittrackr:timer:<workoutId>` | `{ anchor, isRunning, pausedElapsed }` |

Note the four inconsistent naming conventions, and that **`logout()` clears
only `refreshToken`** — theme, plate config, tutorial flag and every
per-workout timer key survive an account switch on a shared device. Timer keys
are never GC'd (only cleared on that workout's finish/delete).

**Tutorial** — `hooks/useTutorial.ts` + `components/tutorial/`. 13 declarative
steps across dashboard → workouts → exercises → trends → programs →
training-goals → profile. Pages opt in by tagging elements
`data-tutorial="key"` (optionally `data-tutorial-ctx="desktop|mobile"`). It
auto-starts 600 ms after mount unless the completion flag is set, navigates to
`step.route`, then `requestAnimationFrame`-polls up to 3 s for the target.
**If you rename or remove a `data-tutorial` attribute, the tour silently
stalls on that step.**



## Things that failed / sharp edges (learn from these)

Ordered roughly by how much damage ignoring them causes. A literal grep for
`TODO|FIXME|HACK|XXX` across the repo returns **nothing** real (the only hits
are the exercise "Hack Squat") — none of this is annotated in the code, which
is exactly why it is written down here.

### Deployment

1. **`docker-entrypoint.sh` swallows migration failures.** If
   `prisma migrate deploy` fails it falls back to
   `prisma db push --skip-generate`; if *that* fails it prints
   `WARNING: db push also failed, starting anyway` and boots regardless.
   `db push` can silently drift or destructively reshape the schema, and the
   last branch runs the API against an unmigrated DB. **If something is
   mysteriously broken after a redeploy, read the container's startup log
   before anything else.** Consider making this fail hard.
2. **`seedExercisesIfEmpty` runs on every boot before `listen()`** with no
   locking — concurrent replicas can double-seed.
3. **The exercise seed list is duplicated** in `prisma/seed.ts` and
   `services/seed.service.ts`. Two sources of truth for the same catalogue.

### Passkeys — the cross-app leakage incident (2026-08-26)

4. **rpId was being stripped to eTLD+1.** `passkey.service.ts` had a
   `getRegistrableDomain()` helper that reduced `fit.geehive.com` →
   `geehive.com`. FitTrackr and MacroTracker are separate apps on separate
   subdomains of the same parent domain, so they ended up sharing one rpId —
   and the authenticator offered MacroTracker's passkeys when signing in to
   FitTrackr. Fixed by using `url.hostname` directly (commit `8cf1540`).
   **Passkeys registered under the old rpId are dead and must be deleted and
   re-registered.** Do not "simplify" this back to a registrable-domain
   helper; the subdomain scoping is the point.
5. **rpID/origin are derived from client-controlled headers** (`Origin`, with
   a `Referer` fallback) and there is **no allowlist** checking the derived
   hostname is one this deployment actually serves. The design intent is
   sound; the missing allowlist is a real gap, and the `Referer` fallback is
   the weaker path.

### Security

6. **The CORS suffix match is too loose.** `config/cors.ts` computes
   `baseDomain = frontendHost.split('.').slice(-2).join('.')` and accepts any
   origin whose host `endsWith(baseDomain)` — with no leading-dot boundary.
   With `FRONTEND_URL=https://fit.geehive.com`, an attacker's
   `https://evilgeehive.com` passes. Partly mitigated by `credentials: false`
   + bearer auth, but it should be a proper boundary check.
7. **`isAdmin` is baked into the 15-minute access token** and the admin hook
   reads it from the token, never the DB. Revoking admin leaves a working
   admin token for up to 15 minutes.
8. **Retroactive admin promotion** (duplicated in `loginUser` and
   `refreshTokens`) promotes the oldest user whenever no admin exists.
9. **`ENCRYPTION_KEY` rotation is unimplemented and destructive.** Rotating
   it orphans every user API key, every SSO cert/secret, and every
   `ProgressPhoto.filePath` — the photo files become both unreachable *and*
   undeletable through the API.
10. **Rate limiting is in-process, not Redis-backed**, despite Redis being
    right there. Global 100/min and auth 10/min multiply by replica count.
11. **`decrypt()` does no format validation** — a malformed value throws a raw
    crypto error into the generic 500 handler instead of a typed error.
12. **Progress-photo files are never GC'd on user deletion.** `deleteUser` is
    a plain `prisma.user.delete`; the rows cascade but
    `DATA_DIR/progress-photos/<userId>/` stays on disk forever.

### Correctness / data

13. **`Workout.exerciseOrder` is append-only** (see invariants). Stale IDs
    accumulate; the frontend filters them out defensively.
14. **`RecordType.MAX_VOLUME` is dead** — present in the enum, the migration,
    and the shared types, but `checkAndUpdatePersonalRecords` only ever writes
    `MAX_WEIGHT`, `MAX_REPS`, `MAX_1RM`.
15. **PR `achievedAt` uses server "today"**, not the workout's `logDate`. So
    back-dated workouts and CSV imports stamp PRs with the import date, in
    UTC, ignoring `UserSettings.timezone`.
16. **1RM is Epley with no rep cap** — a 30-rep set computes to ~2× the
    working weight and will beat any genuine heavy single.
17. **`getWeeklyVolume` counts *sets*, not volume**, for `volumeByMuscle`
    (`+= 1` per set) while `totalWeightKg` is real tonnage. It also
    attributes everything to `primaryMuscle` and ignores `secondaryMuscles`.
    The dashboard "volume rings" are therefore set-count rings.
18. **`isCompleted` cannot be set at set-creation time.** Migration `0004`
    added the column and `addSetSchema` accepts it, but `addSet`'s Prisma
    `create` payload omits it — new sets are always `false` and only
    `updateSet` can flip them. This exact class of bug already bit once:
    `updateSet` mapped every field *except* `isCompleted`, so the completion
    checkbox silently did nothing (fixed in `a5296a1`). **When you add a
    field to a set, check all three places: the Zod schema, `addSet`'s
    create, and `updateSet`'s conditional spread.**
19. **`csv-import.service.ts` parses with naive `split(',')`** — no quoted
    fields, rows with <11 columns silently skipped, `parseFloat(...) || 0`
    coerces bad data to 0 rather than reporting it. Hardcoded to one specific
    third-party export layout.
20. **`ingestImportSchema` is `z.array(z.any())`** and `bulkImportExercises`
    takes `any[]` — admin-supplied AI output flows into `Exercise` creation
    with no validation.
21. **`routes/auth/sso.ts` displayName precedence bug**:
    `(profile.displayName ?? profile.firstName) ? \`${firstName} ${lastName}\` : null`
    — `??` binds tighter than `?:`, so when only `displayName` is present the
    name is still built from first/last, producing empty or `"undefined"`-ish
    strings.
22. **`GET /auth/providers` advertises `PASSKEY` on a global
    `passkey.count()`**, not per-user — the login UI offers passkey auth to
    users who have none as soon as any single user registers one.

### Dead / vestigial

23. **`JWT_REFRESH_SECRET` is required but unused** (refresh tokens are opaque
    random bytes in Redis). Deployments must set a secret that does nothing.
24. **`USDA_FDC_API_KEY` and the whole `getUsdaApiKey`/`usdaApiKeySet`/
    `usdaApiKeyMasked` path** in `app-config.service.ts` is MacroTracker
    carryover with no consumer — yet it is still surfaced by
    `GET /admin/settings` and writable via `PUT`.
25. **`UserSettings.exerciseApiKey` is write-only dead storage** — encrypted
    on write, reported as `hasExerciseApiKey`, never decrypted;
    `wger.service.ts` calls wger.de unauthenticated.
26. **`wger.service.ts` `CATEGORY_MAP` is unreferenced**, and its values
    (`'ARMS'`, `'LEGS'`) are members of neither `MuscleGroup` nor
    `ExerciseCategory`.
27. **`@fastify/auth` and `@fastify/cookie` are registered but effectively
    unused** — auth is pure bearer JWT and no cookie is ever set.

### Consistency traps

28. **Three different ways of applying auth coexist**: scope-wide `onRequest`
    hook (users, measurements, progress-photos, admin), per-route
    `preHandler: [fastify.authenticate]` (exercises, workouts, programs), and
    **in-handler `await fastify.authenticate(request, reply)`**
    (change-password, all four passkey register/list/delete routes). The
    in-handler form **does not stop execution** — `authenticate` calls
    `reply.code(401).send(...)` but the handler body keeps running and relies
    on Fastify ignoring the second send. Prefer `preHandler`.
29. **Response envelopes are inconsistent** — most routes return `{ data }`,
    `listPhotos` returns `{ data, meta: { page, totalPages } }`, admin lists
    return `{ data, pagination: { page, limit, total, totalPages } }`.
30. **AI route errors get flattened to 503 `AI_UNAVAILABLE`** in
    `routes/workouts/index.ts` (both ai-generate and ai-import catch
    everything), discarding the carefully-typed 400/429/502 codes
    `handleProviderError` produced — including "invalid API key". If the user
    reports a useless AI error message, this is why.
31. **`plugins/prisma.ts` instantiates `PrismaClient` at module scope**, so
    it is shared across `buildApp()` calls and `onClose` disconnects the
    singleton — a hazard for integration tests that build multiple apps.
32. **`admin/index.ts` accepts `type: 'csv'`** in `ingestParseSchema`, but
    `exercise-ingest.service.ts` only exports `parsePdfIngest` and
    `parseImagesIngest`. Verify the CSV branch is actually wired before
    telling anyone it works.

### Frontend

33. **Token refresh has no in-flight dedupe.** N concurrent 401s fire N
    refreshes — and because the server *rotates* refresh tokens, those
    requests can invalidate each other. The workout logger, which fires 3–4
    PATCHes per tap, is exactly the shape of traffic that triggers this. A
    mutex/single-flight promise around `refreshAccessToken()` is the fix.
34. **Refresh failure doesn't notify `AuthProvider`** and doesn't clear the
    access token, so the UI can sit logged-in-but-dead until a manual reload.
    There is no global 401 → logout wiring in `QueryProvider` either.
35. **The 401 retry reuses the same `AbortSignal`** — if the original request
    timed out, the signal is already aborted and the retry dies instantly.
    This bites the long-timeout AI calls specifically.
36. **No optimistic updates anywhere** (see the logger section). Biggest
    perceived-performance item in the product.
37. **Dark-mode FOUC.** `ThemeProvider` applies `.dark` in a mount effect
    with no blocking inline script, so the first paint is always light.
    `suppressHydrationWarning` is set but nothing pre-applies the class.
38. **Dark mode has two sources of truth** — `localStorage` (client) and the
    user's server-side setting, mutated separately from `/profile`. The
    provider **never reads the server value**, so they can silently diverge
    across devices.
39. **Cardio inputs need a reload to appear on a fresh exercise** (see the
    logger section) — inference is client-side and only recomputes on
    workout id change.
40. **The warmup ladder is three unbatched POSTs with no rollback** — a
    partial failure leaves a half-built ladder.
41. **`RestTimer` fires `new Notification(...)` but nothing ever calls
    `Notification.requestPermission()`** — the rest-timer notification is
    dead code unless permission happened to be granted elsewhere.
42. **`inferExerciseDetails(name, workoutType)` is duplicated** in
    `workouts/page.tsx` and `programs/page.tsx`, as is the whole
    AI-output → real-exercise hydration loop. Fix a mapping bug in one and
    the other keeps it.
43. **8 `eslint-disable react-hooks/exhaustive-deps` suppressions**, several
    load-bearing (the timer callbacks close over `timerKey`). Genuine
    stale-closure risk if you refactor those hooks casually.
44. **`next lint` is scripted but there is no eslint config in the package**,
    so linting does nothing.
45. **No error boundaries and no `error.tsx` / `not-found.tsx` /
    `loading.tsx` anywhere** in `src/app` — an unhandled render error blanks
    the screen.
46. **Unused declared dependencies**: `html5-qrcode`, `zustand`, `zod`.
    Nothing imports them — notably there is **no Zustand store** despite the
    dep; all state is React-local + TanStack Query.
47. **`SidebarNav.TUTORIAL_KEYS` references `/log` and `/nutrition`** —
    routes that don't exist. MacroTracker leftovers.
48. **Theme color disagrees three ways**: `#4f46e5` (`viewport.themeColor`),
    `#6366f1` (`manifest.json`), and both in the icon generator. Accent color
    is also split — `Button` primary / `Spinner` / `Input` focus are
    **emerald**, while nav and most page chrome are **indigo**.
49. **`cn()` is clsx only — no `tailwind-merge`**, so conflicting utility
    classes don't dedupe; last-in-DOM-order wins unpredictably.
50. **`evalMathExpr` uses `new Function` on user input** (regex-allowlisted
    to `+ - * / ( )` and digits, rejecting non-finite/negative results).
    Defensible, but flag it in any security review.
51. **Tab state is local `useState` everywhere** (profile, admin, trends) —
    not URL-addressable, lost on reload, can't be linked to.
52. **`tsconfig.tsbuildinfo` (189 KB) is committed** in `packages/web`.

### Units

53. **Unit conversion is scattered per-component with no shared display
    helper.** `kgToLbs`/`lbsToKg` are redefined or re-derived in the profile
    page, `SetRow`, and `PlateCalculator`, each deciding independently when to
    convert. This has now caused three separate bugs: `c07f77a` (weight showed
    the wrong unit when settings loaded after workout data), and the plate
    config editing raw kg while the user was set to Imperial. **Any new
    weight-bearing UI needs a deliberate decision about which unit it is
    holding.** kg is canonical in storage; imperial is display-only.
54. **Display rounding makes unit round-trips lossy.** `kgToLbs` rounds to 1
    decimal, so kg → lbs → kg drifts (15 kg → 33.1 lb → 15.01 kg). Any field
    that edits a converted value must no-op when the displayed value hasn't
    changed, or it corrupts the stored number just by being focused. See
    `handleBarWeightCommit` in the profile page for the guard.

### Local build

55. **`pnpm build` cannot complete on Windows.** Next's
    `output: 'standalone'` needs to create symlinks, which fails with `EPERM`
    unless the shell has symlink privilege (Developer Mode / admin). The
    compile and page generation succeed — only the standalone trace copy
    fails. **This is not a real breakage**; the Linux Docker build in CI is
    unaffected. To check a web change locally, read for
    `✓ Compiled successfully` and ignore the trailing EPERM.

## Recent work log (2026-08-26 session)

Six changes, all driven by the author using the app in a gym. Recorded here
because the *reasons* aren't in the diffs.

- **Splash screens redesigned** (`fbc5ec1`) — `makeSplashSvg()` in
  `generate-icons.mjs` now draws the barbell directly on `#030712` with **no
  rounded-rect container**, to match MacroTracker. All 14 splash PNGs + 3
  icons regenerated. The delete-modal fix in the same commit raised modals to
  `z-[200]` and always centers them.
- **Passkey rpId scoped to full hostname** (`8cf1540`) — the cross-app leakage
  incident, sharp edge #4. `getRegistrableDomain()` was deleted.
- **Set completion toggle + persistent timer** (`3c80f81`) — migration `0004`
  added `is_completed`; the checkbox became a real toggle rather than a
  one-shot save, and the stopwatch moved to localStorage so navigating away
  no longer resets it.
- **`isCompleted` actually written to the DB** (`a5296a1`) — the checkbox
  looked broken because `updateSet` mapped every field *except* `isCompleted`.
  See sharp edge #18; this is the canonical example of the three-places rule.
- **Collapsible exercises, bigger buttons, cardio fields** (`79bf051`) —
  three-state collapse (superset/circuit aware), rep-range confirm became
  labeled `px-3 py-1.5` buttons because the icon buttons were unhittable on a
  phone, and `SetRow` gained min:sec + distance inputs for cardio.
- **Exercise reordering + admin rename** (`cbfe6c7`) — migration `0005` added
  `exercise_order TEXT[]`. Ordering was made an explicit persisted array
  rather than inferred from set timestamps. Admin got *rename* rather than
  delete-and-recreate because `WorkoutSet.exerciseId` doesn't cascade, so a
  referenced exercise can't be deleted.

Then, same day, a second batch:

- **Plate config respects the unit setting** — the editor was labelled and
  edited in raw kg regardless of preference, so an Imperial user saw their
  45 lb bar as "20.41 kg". Bar weights now display/edit in the user's unit
  (storage stays kg), typing goes through a draft so conversion can't mangle
  keystrokes, an unchanged blur is a no-op (edge #54), and the Available
  Plates list shows only the active unit — it previously rendered both a
  Metric and an Imperial row while the calculator only ever read one.
- **AI errors became diagnosable** — three unguarded spots all produced the
  bare 500 "An unexpected error occurred": a plain `throw new Error` on
  JSON-parse failure, `decrypt()` sitting outside `resolveProviderAndKey`'s
  try/catch, and no truncation detection at all. All three now throw typed
  errors, and 500s carry a short ref id matching the log line.
- **Program generation stopped truncating** — this was a real reported bug.
  The prompt asked the model to write out **every week longhand**, which does
  not scale: measured at ~101 output tok/s, 8 weeks x 4 days needs ~13k tokens
  (129 s — past the 120 s client timeout) and the UI's maximum 24 x 7 needs
  ~67k (past every model's output cap, ~11 min). It now asks for **one week
  plus a compact per-week progression** and expands that server-side into the
  same stored `weeks[]` shape, so the frontend was untouched and output is
  ~2k tokens at any duration. Progressive overload is now deterministic
  arithmetic rather than the model doing 8 weeks of mental math. Expansion
  logic is isolated in `program-expand.ts` with 33 tests.
- **Start-your-watch reminder** — non-blocking banner on workout start
  (deliberately not a modal; see the Goal section). Auto-dismisses after 12 s.
  "Don't remind me again" writes `fittrackr_watch_reminder=off`, and there is
  a toggle in Profile → Settings so it isn't a one-way door.
- **Plate calculator bar is one piece** — it was three divs (two `rounded-sm`
  collars either side of a `rounded-full` shaft) that read as separate shapes.
  Now a single square-ended rect.
- **Single-sided (sled) bar support** — bars carry `perSide?: boolean`. When
  `false` the target is not halved, plates render as one stack, and the label
  reads "Load:" not "Each side:". Absent means `true`, so configs saved before
  this keep working. A `2 sides` / `1 side` toggle sits on each bar row in
  settings, and a Sled preset is in the defaults.
- **Logo refined** — one continuous bar, knurling dropped (5px marks merged
  into a smudge at favicon size). `logo.svg`/`favicon.svg` had never been
  updated from the pre-rename **blue** palette and still carried grip
  notches; both now match the icon geometry in mid-tone indigo (they render on
  transparent backgrounds, so the icon's pale tints would be invisible).
  `logo-flame.svg` was an identically-blue copy, still referenced by
  `SidebarNav` despite not having been a flame for a long time — deleted, and
  the reference repointed at `logo.svg`. All 3 icons + 14 splashes regenerated.
  **Note the geometry is duplicated in three places** — `ICON_SVG` and
  `makeSplashSvg` in `generate-icons.mjs`, plus `logo.svg`/`favicon.svg` — and
  must be kept in sync by hand.

## Current state

Deployed and in daily real use by the author against real workout data. The
Docker Hub images track `main` automatically; the Portainer stack is updated
by hand with "Pull and redeploy".

`main` is clean as of `cbfe6c7`. Migration `0005` is applied by the entrypoint
on redeploy — no manual step outstanding.

Known outstanding user-facing item: **any passkey registered before commit
`8cf1540` is dead** (old eTLD+1 rpId) and must be deleted and re-registered.

No known open bugs beyond the sharp edges above, none of which are currently
blocking the author's use.

## Next steps (not built, roughly by value)

1. **Optimistic updates in the workout logger** (#36). This is the one the
   user will actually feel — every set commit and completion checkbox
   currently round-trips. `onMutate` + `setQueryData` on the set PATCH is the
   highest-value change in this list.
2. **Single-flight the token refresh** (#33) and wire refresh failure back to
   `AuthProvider` (#34). The logger's burst of PATCHes is the exact traffic
   pattern that can rotate two refresh tokens into each other.
3. **Make `docker-entrypoint.sh` fail hard** instead of falling through to
   `db push` and then starting anyway (sharp edge #1). Highest
   damage-per-effort item on the backend.
4. **Fix the CORS boundary check** (#6) — a one-line change to require a
   leading dot or an exact match — and **add an rpID allowlist** (#5).
5. **Store cardio as a property, not an inference** (#39) — read
   `Exercise.category === 'CARDIO'` (or add a flag) so the time/distance
   inputs appear without a reload.
6. **Kill the dark-mode FOUC** (#37) with a blocking inline script, and pick
   one source of truth for the preference (#38).
7. **Prune `exerciseOrder` in `deleteSet`** (#13) so the array stops drifting,
   and drop the frontend's defensive filter once it does.
8. **Cap Epley reps** (#16) and **make `volumeByMuscle` actual volume** (#17),
   or rename it `setsByMuscle` and stop calling the dashboard rings "volume".
9. **Delete the MacroTracker carryover** — `USDA_FDC_API_KEY` and its admin
   settings surface (#24), `exerciseApiKey` (#25), `CATEGORY_MAP` (#26),
   `JWT_REFRESH_SECRET` (#23), the stale `TUTORIAL_KEYS` (#47), the unused
   deps (#46). Cheap, and each one is a future "why is this here?".
10. **Re-check admin from the DB** in the admin hook (#7) rather than
    trusting the token claim.
11. **Add an eslint config** so `next lint` stops being a no-op (#44), and
    **add `error.tsx`** so a render error doesn't blank the screen (#45).
12. **Split `profile/page.tsx` (1956 lines) and `admin/page.tsx` (1266)** —
    both are ~12 components in one file.
13. **An `@theme` token layer in `globals.css`** if the design system is ever
    to be formalized, which would also resolve the emerald/indigo accent
    split and the three-way theme-color disagreement (#48).
14. **Redis-backed rate limiting** (#10) — only matters if a second replica
    ever exists.

## Testing pattern used throughout

There is **no test framework, no test suite, and no working linter.**
Verification is manual:
build (`pnpm build` catches the TypeScript strict-mode errors, which have
broken CI more than once — see commits `c387af7`, `31ec8d5`, `c64a332`,
`dc6cbcf`, `273dfae`), then drive the real UI, usually on a phone, against
the deployed stack.

Practical consequences worth internalizing:

- **The API build is the only real gate.** TS strict mode is the safety net;
  do not `any`-cast past it, because nothing downstream will catch you.
- **Schema changes touch three packages**: `prisma/schema.prisma` (+ a
  migration), `packages/shared/src/types/*` and `validation/*.schema.ts`, and
  then the service's create/update payloads. Missing the service layer is the
  bug that shipped twice (#18).
- **Test against the real deployment for anything mobile-shaped.** Every
  workout-logging UX problem — off-screen delete modal, tap targets too small
  to hit, the timer resetting on navigation, the completion checkbox not
  checking — was found by the author using the app in a gym, not by
  inspection. The dev server on a desktop browser will not surface them.
- **The service worker is disabled in development**, so anything PWA-shaped
  (install, splash, offline, iOS status bar) can only be tested against a
  built/deployed instance.
- `generate-icons.mjs` is run by hand from the repo root after any icon or
  splash change; nothing runs it for you.
