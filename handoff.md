# HANDOFF — FitTrackr

_Last updated: 2026-09-02 (through the editable-exercise-library commit — five
new muscle groups, a full exercise editor in admin, whole-exercise delete in
the logger; earlier: optimistic set updates so the logger no longer
round-trips on every commit; Awards tab with struck medals,
AI Coach, weekly-goal streak and consistency badges, PR recompute, set-row
headers, cardio-mode memory; earlier: random-logout and frozen-app
fixes, cardio/bodyweight handling, exercise replay, duration editing;
workout and program summaries, PR tracking, plate-calculator units and sled
support, program generation rewritten to a week template, AI suggest's
backwards deload fixed, RPE capped, watch reminder, logo and splash refresh,
iOS layout fixes, and the project's first tests). Written as a handoff for the
next engineer (or AI session) picking this up. The user-facing feature list and
setup instructions live in [README.md](README.md); **this file is about intent,
state, and sharp edges** — the things you would otherwise have to rediscover by
breaking something._

> **Read sharp edges #56–#84 before touching iOS layout, asset generation, AI
> prompts, summaries/PRs/awards, the auth/refresh path, persisted timer state,
> cardio/bodyweight handling, or trusting any `git`/`gh`/preview command in
> this workspace.** Those cost the most time to learn. If you only read three:
> **#77** (a hook below an early return took the whole workout page down in
> production), **#64a/#64b** (a scoped `git add` plus a stale `shared/dist`
> break CI while your local build stays green) and **#74** (filtering on
> `weightKg` deletes cardio and bodyweight work — it has shipped twice).
>
> **Three test suites, 146 assertions:** `pnpm --filter @fittrackr/api test`.

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
| `0006_workout_program_link` | `workouts.program_id` (FK, **SET NULL**) + `program_week` / `program_day` |
| `0007_exercise_pref_cardio` | `exercise_preferences.is_cardio BOOLEAN` (nullable = infer) |
| `0008_muscle_groups` | `ALTER TYPE "MuscleGroup" ADD VALUE` ×5: `LATS`, `TRAPS`, `ADDUCTORS`, `ABDUCTORS`, `OBLIQUES` |

**Adding a muscle group** (or any enum value) is `ALTER TYPE … ADD VALUE`, and
it is **additive only** — you cannot remove or rename a value while any row
references it, which is why `FULL_BODY` was fixed by rendering a *label* rather
than renaming the enum member. The TypeScript side has one source of truth,
`muscleGroupValues` in `packages/shared/src/validation/exercise.schema.ts`: the
`MuscleGroup` union is derived from it, `MUSCLE_GROUP_LABELS` /
`MUSCLE_GROUP_COLORS` are `Record<MuscleGroup, …>` so the build fails until a
new value has both, and the three AI prompts interpolate the array instead of
listing it. **The one place still manual is the Prisma enum** — schema.prisma
plus a migration. Keep the appended order identical in both, since
`ADD VALUE` appends to the Postgres type's sort order.

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
6b. ~~**The superset routes had no ownership check.**~~ **FIXED** — both
    `POST /workouts/:id/superset` and `DELETE /workouts/:id/superset/:groupId`
    write with a raw `prisma.workoutSet.updateMany({ where: { workoutId } })`
    and neither verified who owns the workout, so being authenticated as
    anybody was enough to regroup or ungroup another user's sets. They call
    `workoutService.assertWorkoutOwner` now. **Any route that reaches for
    `prisma` directly instead of a service function needs that call** — every
    service function does the check itself, which is exactly why these two
    slipped through.
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

13. **`Workout.exerciseOrder` is append-only** (see invariants) — except in
    `deleteWorkoutExercise`, which is the one path that knows an exercise is
    gone for good and prunes it. `deleteSet` still doesn't, so stale IDs still
    accumulate when you empty an exercise set-by-set, and the frontend still
    filters them out defensively.
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
    with no validation. (`PATCH /admin/exercises/:id` was the same
    `request.body as any` until the editor needed it; it parses
    `updateExerciseSchema` now, so a bad muscle group is a 422 naming the
    field instead of a raw Postgres enum cast error surfacing as a 500. Note
    `updateExerciseSchema` is `createExerciseSchema.partial()` and the
    `.default()`s do **not** leak through the `.partial()` — verified, because
    if they did, renaming an exercise would silently wipe its
    `secondaryMuscles` and reset `equipment` to `BODYWEIGHT`.)
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

33. ~~**Token refresh has no in-flight dedupe.**~~ **FIXED** — this was the
    cause of the reported random logouts. N concurrent 401s each fired their
    own refresh with the same token; the server rotates (deletes the presented
    token and issues a new pair), so the first won and the rest were rejected
    and **wiped the refresh token the winner had just stored**. Next mount:
    logged out. `refreshAccessToken()` is now single-flight via a shared
    `refreshPromise`, and a request whose token changed while it was in flight
    retries with the current token instead of refreshing again. **Do not add
    another refresh call path without going through it.**
34. ~~**Refresh failure doesn't notify `AuthProvider`.**~~ **FIXED** — this was
    the cause of the reported "app is unresponsive until I back out and go
    back in". The app stayed nominally logged in with a dead token: every
    request 401'd, every mutation failed, and `SetRow` had no `onError`, so a
    tapped checkbox simply did nothing. `setAuthFailureHandler` now lets
    `AuthProvider` drop the user so the guard redirects to login. Note the
    corollary fix: refresh and `refreshUser` only clear tokens on **401/403**.
    They previously cleared on *any* non-2xx, so a single 500 or dropped
    connection ended the session.
35. ~~**The 401 retry reuses the same `AbortSignal`.**~~ **FIXED** — each
    attempt now builds its own signal.
36. ~~**No optimistic updates anywhere**~~ **PARTLY FIXED** — the set
    `PATCH` and `DELETE` in `SetRow` now patch the `['workout', id]` cache in
    `onMutate` and roll back from a snapshot in `onError`, so a blur commit and
    a completion tap land instantly. Two things to preserve if you touch it:
    the `onError` rollback (without it a rejected patch stays on screen, which
    is *worse* than the old silent failure), and `invalidateIfLast` — only the
    last set mutation still running may invalidate, because otherwise an
    earlier request's refetch returns data predating a later request's
    optimistic patch and the row flickers back. **The page's own mutations
    (add set, add warmup, delete exercise, reorder) still invalidate
    unconditionally**, so one of those completing while a set patch is in
    flight can still flicker that row. Not seen in practice — those taps
    aren't concurrent with a field blur — but that is the residual.
37. **Dark-mode FOUC.** `ThemeProvider` applies `.dark` in a mount effect
    with no blocking inline script, so the first paint is always light.
    `suppressHydrationWarning` is set but nothing pre-applies the class.
38. **Dark mode has two sources of truth** — `localStorage` (client) and the
    user's server-side setting, mutated separately from `/profile`. The
    provider **never reads the server value**, so they can silently diverge
    across devices.
39. ~~**Cardio inputs need a reload to appear on a fresh exercise.**~~
    **FIXED** (`3a72dcf`) — migration `0007` added
    `exercise_preferences.is_cardio`, and the mode now resolves as: the saved
    preference → the exercise's own `CARDIO` category → the old set-shape
    inference. NULL preserves the previous behaviour for existing rows, and an
    explicit "no" beats the inference so one duration logged against a barbell
    lift can't flip its mode.
40. **The warmup ladder is three unbatched POSTs with no rollback** — a
    partial failure leaves a half-built ladder.
41. **`RestTimer` fires `new Notification(...)` but nothing ever calls
    `Notification.requestPermission()`** — the rest-timer notification is
    dead code unless permission happened to be granted elsewhere.
42. ~~**`inferExerciseDetails(name, workoutType)` is duplicated**~~ **FIXED** —
    and it had already drifted exactly as predicted: the `programs/page.tsx`
    copy knew about pushdowns, leg curls, forearms, trap-bar deadlifts,
    resistance bands and olympic lifts while the `workouts/page.tsx` copy did
    not, so the same AI response hydrated differently depending on which screen
    produced it. Now one module, `lib/infer-exercise.ts`. **Its rule ORDER is
    load-bearing** — every rule is a substring test, so a broader pattern
    placed earlier swallows a narrower one: `' ab'` (abs) matches "hip
    ABductor", `'lat'` matches "LATeral raise", `'trap'` matches "TRAP bar
    deadlift", and `'curl'` matches both "leg curl" and "wrist curl". Each of
    those has a negative assertion in the harness. **The AI-output →
    real-exercise hydration loop around it is still duplicated.**
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
    classes don't dedupe and the winner is decided by **stylesheet order, not
    class order**. This was not theoretical: `SetRow` passed `w-20`/`w-16`/
    `w-14` into `MathInput`, which puts `className` on an `<input>` that
    already carries `w-full`. `.w-full` appears later in the compiled CSS, so
    it won and those widths were **silently dead** for months — the fields had
    been flexing all along. Confirmed by grepping the built stylesheet for the
    rule offsets. If a width looks ignored, check the compiled CSS before
    assuming your class is wrong.
50. **`evalMathExpr` uses `new Function` on user input** (regex-allowlisted
    to `+ - * / ( )` and digits, rejecting non-finite/negative results).
    Defensible, but flag it in any security review.
51. **Tab state is local `useState` everywhere** (profile, admin, trends) —
    not URL-addressable, lost on reload, can't be linked to.
52. **`tsconfig.tsbuildinfo` (189 KB) is committed** in `packages/web`.

### Enums and labels

83. **Never render an enum value as a label.** `WorkoutCard` printed
    `primaryMuscle` straight, so the muscle chips read "FULL_BODY", and the
    admin exercise list read "GLUTES · machine · MANUAL". Fixing this by
    renaming the enum member would have been a destructive Postgres migration
    for a display bug. `MUSCLE_GROUP_LABELS` already existed; the render sites
    just weren't using it. `muscleGroupLabel()` / `equipmentLabel()` /
    `exerciseCategoryLabel()` in shared take a loose `string` (which is how API
    rows are typed in several places) and fall back to the raw value, so a
    group the deployed database has but this build's constants do not renders
    as itself rather than `undefined`.
84. **Hand-written copies of an enum drift silently.** There were FIVE lists of
    the exercise enums in the web package alone — `MUSCLE_OPTIONS`,
    `CATEGORY_OPTIONS` and `EQUIPMENT_OPTIONS` in `exercises/page.tsx`, plus
    `EQUIPMENT_LABELS`, `CATEGORY_LABELS` and `ALL_MUSCLES` in
    `ExerciseSearchForm.tsx`. The equipment one **was missing `KETTLEBELL`**,
    so a kettlebell exercise could not be created from that screen at all, and
    nothing failed — the option simply wasn't there. All of them now derive
    from `ALL_MUSCLE_GROUPS` / `ALL_EQUIPMENT` / `ALL_EXERCISE_CATEGORIES`.
    Same reasoning for the AI prompts: a muscle group the model is never told
    about is one it can never return.

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

### iOS / PWA

56. **`position: fixed` + `backdrop-filter` breaks on iOS Safari.** A fixed
    element carrying `backdrop-blur-*` gets detached from the viewport during
    scroll and drifts up the page. This is what made `BottomNav` float in the
    middle of the screen mid-scroll, and it is very likely the same root cause
    as the delete modal appearing off-screen (which was "fixed" back then by
    raising `z-index`, i.e. never actually diagnosed). **Do not put
    `backdrop-blur` on a fixed element.** The nav is now opaque with
    `transform: translateZ(0)` to force its own compositing layer. Other
    `Card`s keep `dark:backdrop-blur-sm` safely because they are not fixed.
57. **`pt-safe*` does not protect scrolled content.** With
    `viewportFit: 'cover'` the page paints into the status-bar inset; padding
    only sets the *initial* offset, so anything scrolled up collides with the
    clock/signal/battery. That needs a fixed scrim sized to
    `env(safe-area-inset-top)` — there is one in the dashboard layout.
58. **iOS caches `apple-touch-startup-image` against the installed app.** A
    redeploy does not update the splash screen, and neither does a hard
    refresh. The home-screen icon must be **deleted and re-added**. This cost
    a long round of "it's still wrong" while the server was already serving
    the correct file — verify with
    `curl -s <host>/splash/v2-iPhone_16.png | wc -c` against the committed
    byte count before believing a splash bug is in the code.
59. **The splash wordmark's font is baked in at generation time.** It is
    whatever the machine running `generate-icons.mjs` resolves (Segoe UI on
    the author's Windows box), while the login page renders live and uses SF
    Pro on iOS. They match on desktop and are close-but-not-identical on
    iPhone. To make them truly identical the wordmark would have to be drawn
    as vector paths.
60. **librsvg does not resolve `system-ui`** — and sharp uses librsvg to
    rasterise SVG. A `font-family` of `system-ui,-apple-system,…` silently
    fell back to a **monospace** default, which is why the splash looked like
    code for a long time. Verified by rendering `system-ui` and a deliberately
    nonexistent font side by side: byte-for-byte identical output. **Name real
    font families in anything sharp will rasterise.** Quoting is not the
    issue; `Segoe UI` unquoted resolves fine.

### AI prompting

61. **A prompt that supplies data but no rules will invent the rules.** The
    exercise ai-suggest endpoint was handed a rep range and a set history with
    no statement of how they relate, and concluded that *exceeding* the range
    (10 reps against a 6–8 target) meant drifting off-plan — recommending a
    deload from 155 lb to 145 lb, i.e. undoing earned progress. Beating a rep
    range is the signal to *add load*. The prompt now states double
    progression explicitly, and the last-session-vs-range comparison is
    computed in `preferences.ts` and passed in as an `ANALYSIS` line rather
    than inferred. **When a decision is a rule, compute it; don't ask a
    light-tier model to derive it.**
62. **RPE progression plateaus rather than ramps.** `clampRpe` caps upward
    movement at `RPE_CEILING` (9) and at `MAX_RPE_RISE` (+2) over the
    template, which stops the "every exercise at RPE 10" bug. But if the
    model returns a saturating `rpeDelta` curve (+0,+1,+2,+2,+2…) the result
    is a flat 9 for the back half of the program. The ceiling is enforced;
    the *shape* is still the model's call. The real fix, if it matters, is to
    have the model emit an absolute per-week RPE or an explicit deload
    cadence instead of a monotonic delta.

### Summaries and PRs

65. **Program adherence only works forward from migration `0006`.** Sessions
    are matched to a program through `Workout.programId`, stamped when you
    press Start Workout on a program day. Any workout logged before that
    column existed, or started from the Workouts tab, has no `programId` and
    is invisible to the program summary. The summary's empty state says so
    explicitly rather than showing a bare 0% — **do not "fix" it by falling
    back to a date-range match**, which would silently attribute unrelated
    sessions to a program.
66. **PRs were only checked when a set was created, never when edited.** Sets
    are created carrying the previous session's weight and corrected
    afterwards, so a genuine PR typed into an existing row was silently
    dropped. `updateSet` now re-checks whenever weight, reps, or the warmup
    flag change. If you add another way to mutate a set, it needs the same
    call.
67. **`MAX_1RM` is not recorded above 12 reps** (`MAX_1RM_REPS`). Epley
    inflates badly past that, and an uncapped estimate from a high-rep set
    would beat every genuine heavy single and then sit there permanently,
    because PRs are stored one-row-per-type with no history (#3). Declining
    to estimate is deliberate.
68. **The workout summary compares per EXERCISE, not per workout.** "Last
    time" for bench press is the most recent previous session containing bench
    press, which may be several workouts ago. Same-day duplicate workouts
    resolve arbitrarily. First-time exercises are flagged rather than shown as
    an infinite improvement.
69. **Volume needs both weight and reps.** `tally` counts a set toward `sets`
    and `totalReps` but contributes no volume when either is null, so
    bodyweight and cardio work does not read as zero-weight strength work.
    "Best set" means highest volume, not heaviest weight — a 1x100 single does
    not outrank 10x50. Both behaviours are pinned by tests.

### Request volume

70. **The global rate limit was 100/min and a normal session exceeded it.**
    Completing a set used to fire **four** PATCHes (weight, reps, RPE, then
    the completion flag), each invalidating `['workout', id]` and triggering a
    refetch — roughly eight requests per checkbox tap. Twelve sets was ~100
    requests, so a dense session hit the limit, and the resulting 429 showed
    up as a save that silently did nothing. Two changes: completion now sends
    **one** PATCH carrying every field, and the limit is 600/min.
    **Keying is per-IP and cannot be per-user** — the rate-limit hook runs
    before `authPlugin`, so `request.user` is not populated yet. Don't "fix"
    that with a `keyGenerator` reading `request.user`; it silently falls back
    to IP for every request.
71. **Mutations in the logger had no `onError`.** Every failure — 429, 401,
    network — was invisible: the checkbox just didn't tick. `SetRow` now shows
    the message inline. Any new mutation on the logging path needs the same,
    or it will reproduce the "app is frozen" report.

### Persisted state and input

72. **Anything read back from `localStorage` here needs range validation.**
    The workout clock has now produced three separate bugs from trusting it.
    The worst: `finishMutation` called `clearTimerState()` and *then*
    `pauseClock()`, which persists — so finishing re-created the key it had
    just deleted, with `anchor` still `0`. That restored as
    `Date.now()/1000` ≈ **496627 hours**, and Finish wrote it to the workout
    as ~29.8 million minutes. Restore now rejects a non-finite/zero/negative
    anchor and any elapsed beyond 24 h, `durationMin` is clamped client-side,
    and `createWorkoutSchema` caps it at 1440. **Validate on read; a writer
    you didn't expect will eventually put junk in there.**
73. **`inputMode="numeric"` has no decimal point.** A phone keypad in numeric
    mode cannot type `1.5`, so the cardio distance field was unusable for any
    fractional distance. Use `inputMode="decimal"` for anything fractional —
    and pair it with `step="any"`, because `type="number"` defaults to
    `step=1`, which *also* marks fractional values invalid. `MathInput`
    already defaults to `decimal`; raw `<input type="number">` does not.

### Cardio and bodyweight are not "missing data"

74. **Filtering on `weightKg != null` silently deletes real work.** This has
    now shipped twice. In the AI-suggest history builder it meant pull-ups
    produced "(no working sets)" and the model had nothing to reason about;
    in the summary `tally()` it meant a 9-minute walk read as "1 set, 1 rep"
    because duration and distance were never accumulated. **A set is real if
    it has reps OR duration OR distance** — weight is one dimension of it, not
    a precondition. Both paths now branch on what the set actually contains,
    and the AI prompt has an explicit bodyweight rule (progress by reps, then
    added load or a harder variation, `targetWeight` null).
75. **Rest starts after a ROUND, not after a set.** In a superset/circuit you
    move straight to the next exercise, so firing the timer per set fired it
    mid-round. `handleSetLogged(exerciseId, roundNumber)` waits until every
    group member's set at that round is complete. Two details that are easy to
    get wrong: the set that just fired the callback still reads incomplete in
    the cache (its refetch is in flight, so treat it as done), and a member
    with **no** set at that round must be skipped or an uneven group never
    triggers the timer at all.
76. **Multi-POST actions can partly succeed.** Adding an exercise replays the
    last session by POSTing one set per historical set; the warmup ladder
    POSTs three. Neither is transactional, so a mid-sequence failure leaves
    real sets behind. Both surface the error rather than closing as though
    they worked, but the honest fix is a bulk-create endpoint.

### React and rendering

77. **Every hook must sit ABOVE the component's early returns.** This shipped a
    production crash (`4daa7a7`): a `useMutation` was added next to the
    function that used it, which happened to be below
    `if (isLoading) return …` / `if (!workout) return null`. The loading pass
    registered N hooks, the loaded pass N+1, and React threw **error #310**
    ("rendered more hooks than during the previous render") — every workout
    detail page died with a blank client-side exception. **A green typecheck
    and build prove nothing about hook order**; the only check is rendering
    the page. `workouts/[id]/page.tsx` has ~20 hooks and two early returns
    around line 567: put new hooks with the other hooks, not next to their
    consumer.
78. **SVG gradient ids must be unique per instance.** The Awards tab renders
    ~23 `<Medal>` components, each defining its own `linearGradient`.
    Hard-coded ids would make every medal render in the *first* medal's metal,
    because ids are document-global. `Medal.tsx` suffixes them from the tier,
    label and earned state.
79. **Build calendar dates with `new Date(y, m, n)`, never millisecond
    arithmetic.** Adding `i * 86400000` to a start date shifts by an hour
    across a DST transition and eventually skips or repeats a day. The
    workouts calendar relies on `new Date(viewYear, viewMonth, 1 - pad + i)`,
    which handles both month/year rollover and DST. A test asserting
    contiguity via epoch deltas *falsely fails* on all 14 US transitions —
    compare calendar dates in UTC instead.

### Awards and benchmarks

80. **Benchmark matching is deliberately strict, and must stay that way.**
    `classifyLift` in `awards-rules.ts` refuses incline/decline/dumbbell/
    Smith/close-grip presses as a bench, front/goblet/hack squats as a squat,
    and RDL/stiff-leg as a deadlift. The author's own log contains "Barbell
    Incline Bench Press" and "Dumbbell Bench Press" — a loose matcher would
    hand out a "225 lb bench" medal that was never earned, which makes the
    entire tab worthless. Widen the include lists only with a matching
    exclusion test.
81. **Absolute thresholds are compared in POUNDS, not kg.** The plate-club
    numbers (135/225/315/405) are plate math. Storage is kg, and a kg
    round-trip can leave a genuine 225 lb lift a hair short of the threshold —
    there is a test pinning exactly that. Relative tiers compare in kg, since
    they are a ratio against bodyweight.
82. **"Unknown" is not "zero".** A relative award with no bodyweight on file
    reports `progress: null`, not `0` — a row of empty progress bars would
    claim the athlete has made no progress when the app simply cannot tell.
    The UI branches on null.

### Tooling hazards in this workspace

63. **The primary working directory is `D:\dev\MacroTracker`, not FitTrackr.**
    This bites constantly and in ways that look like real bugs:
    - The Bash cwd resets to MacroTracker between calls, so bare `git status`
      can silently report the **wrong repository** (it once showed "behind 1,
      nothing to push" against `MacroTrackr.git`). Use `git -C /d/dev/FitTrackr`
      or `cd` first, and sanity-check `git remote -v`.
    - `gh` resolves the wrong repo for the same reason. Pass
      `-R stevegee006/FitTrackr` explicitly.
    - `preview_start` resolves `.claude/launch.json` from the primary working
      directory, so it boots **MacroTrackr's** dev server on :3000. A browser
      check run that way is measuring the wrong app entirely.
64a. **NEVER scope `git add` to a subset of packages.** A commit staged with
    `git add -A packages/api packages/web` silently dropped `packages/shared`,
    so the API built in CI against a shared package missing the fields it
    used — three `TS2339`s on `CreateWorkoutInput`. `packages/shared` is the
    contract between the other two; stage the whole tree or explicit full
    paths, and read `git status` before committing.
64b. **A green local build proves nothing when `packages/shared/dist` is
    stale.** The commit above passed locally precisely *because* `dist` had
    already been rebuilt with the change — `tsc` happily resolved fields that
    existed only on disk. For anything touching `packages/shared`:
    `rm -rf packages/shared/dist && pnpm --filter @fittrackr/shared build`
    before believing a typecheck.
64. **Runtime-injected Tailwind classes prove nothing.** Tailwind only
    generates utilities it finds in *source*, so testing a class by creating
    an element in the page console and reading `getComputedStyle` reports
    "not applied" for classes that work fine in the real build. For one-off
    values prefer an inline `style` — an arbitrary class that fails to
    generate fails *silently*. Both the safe-area scrim height and the nav's
    `translateZ(0)` are inline for this reason, as is the settings toggle knob
    offset.

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

And a third batch, after the author deployed and used it:

- **AI suggest recommended a deload for beating the rep range** (`a2ed81c`) —
  the headline bug of the session, see sharp edge #61. Fixed by stating double
  progression in the prompt and computing the range comparison server-side.
  Confirmed working on the real deployment: the same exercise now returns
  "Increase Weight … add 5–10 lbs to move to 160–165 lbs".
- **RPE progression capped** (`ff459c2`) — an 8-week program came back with
  every exercise at RPE 10. See #62 for the residual plateau.
- **First tests in the project** (`ff459c2`) —
  `packages/api/test/program-expand.test.mjs`, 48 assertions. An earlier
  commit message had referred to tests that only existed in a scratchpad and
  were never committed; this makes that claim true.
- **Splash wordmark font** (`a997701`) — see #60 for the librsvg cause and #58
  for why it then *looked* unfixed for another hour.
- **Watch reminder became blocking** (`4ff56b8`) — first shipped as a
  non-blocking auto-dismissing banner on the reasoning in the Goal section
  (never add a tap to the logging flow). The author asked for a modal that
  gates the clock, which is right: it fires once, *before* logging starts, and
  the point is that the watch and the clock start together. The
  no-modals principle still holds for everything during set logging.
- **Settings toggle knob rendered outside its track** (`4ff56b8`) — an
  absolutely positioned span with no `left` resolves against its static
  position. Now a padded flex child with an inline offset.
- **Programs: week selector moved above the day strip** (`4ff56b8`) — days
  were on top with weeks appearing below them only once expanded, which read
  backwards.
- **Plate calculator remembers the last bar per exercise** (`4ff56b8`), keyed
  by bar *name* — indices shift when bars are added, removed, or reordered.
- **Bottom nav pinned, status-bar scrim added** (`e47c397`) — see #56 and #57.
  **Not device-verified.**

And a fourth batch — summaries and PR tracking:

- **Workout summary** (`0ea66a7`) — `GET /workouts/:id/summary`, page at
  `/workouts/[id]/summary`. Finishing lands there instead of the list. Session
  totals, per-exercise comparison against the last session containing that
  exercise (#68), and PRs earned. Tally arithmetic lives in
  `workout-summary.ts` with 28 assertions (#69).
- **PR tracking made trustworthy** (`0ea66a7`) — a PRs sub-tab under
  Profile → Bio, plus three fixes needed before the numbers were worth
  showing: PRs are re-checked on set *edit* (#66), `achievedAt` uses the
  workout's `logDate` instead of the server's today, and `MAX_1RM` is no
  longer estimated above 12 reps (#67).
- **Program summary** (`a4a21bb`) — migration `0006` links a workout to the
  program day it came from (`program_id` SET NULL, plus week/day).
  `GET /programs/:id/summary` reports adherence, totals, per-exercise
  first→last top weight, sets per muscle, and PRs in the window. Reachable
  from the chart icon on each program card. **Only measures forward from this
  migration** (#65).

And a fifth batch — polish, then two real bug reports:

- **PRs list search** (`fca28e4`) — client-side filter over the already-fetched
  list.
- **Corrupt workout clock** (`585c960`) — see #72. Duration is now editable
  (pencil in the workout header and on the summary), which is also the repair
  path for workouts already carrying a bad value.
- **Duration in hours and minutes** (`cd8fb66`) — separate H/M fields, and
  `formatDuration`/`splitDuration` in `lib/utils` now feed **every** display
  (workout summary, program summary, workouts list, `WorkoutCard`). Four sites
  had four different formats before.
- **Finish celebration** (`8dfcb5c`) — `CelebrationBurst`, CSS keyframes, no
  dependency. `pointer-events-none`, particles generated in an effect (not
  during render, which would mismatch hydration), self-unmounting, and
  disabled under `prefers-reduced-motion`. Fires once per finish via a
  `sessionStorage` flag cleared as it's read.
- **Random logouts + the frozen app** (`0d53807`) — the big one; see #33–35
  and #70–71. Both symptoms were the refresh path.
- **Decimal keypads, cardio summaries, superset rest timing, bodyweight AI**
  (`cf7679d`) — see #73–75 and #74.
- **Adding an exercise replays the last session** (`a9c8b57`) — new
  `GET /exercises/:id/last-session`; recreates the same set count with reps,
  weight, RPE and any time/distance. Falls back to the rep-range preference
  (`targetSets` clamped 1–10), then one blank set. Adding an exercise already
  in the workout still appends a single set. See #76.

And a sixth batch — coaching, awards, and one self-inflicted outage:

- **Calendar fills its edges** (`628cc9a`) — leading/trailing days from the
  adjacent months, dimmed and non-selectable. The workouts query widened to the
  visible grid so those days still show real dots. See #79 for the DST trap.
- **AI Coach** (`d0f8892`) — button in the dashboard header → `/coach`.
  `GET /coach/review?days=30` gathers the window with no AI first (sessions,
  sets per muscle vs goal, tonnage, top 12 exercises first→last top weight,
  PRs), then asks for structured advice. Cached for the session so revisiting
  doesn't re-spend a call; an empty window returns `NO_TRAINING_DATA` rather
  than paying to be told there's nothing there.
- **Streak is weekly, not daily** (`2c5b8fd`) — consecutive weeks meeting
  `UserProfile.weeklyFrequency` (now editable in Profile → Bio; it existed in
  the schema with no UI). The in-progress week doesn't break a run, only
  extends it — otherwise the streak collapsed every Monday. Range query went
  30 → 190 days. Logic in `lib/streak.ts`.
- **Consistency badges** (`cfc14d4`) — 2/4/8/12/26/52 weeks, one array in
  `lib/streak.ts`. Highest earned shows, next as a nudge.
- **PRs can be corrected downward** (`18759b8`) — see #3. A mistyped rep count
  had stranded "Most reps 35" permanently.
- **Set-row column headers** (`bed5566`) — and the discovery behind #49: the
  `w-20`/`w-16`/`w-14` widths had been dead all along.
- **Cardio mode remembered + RPE dropped from cardio rows** (`3a72dcf`) —
  migration `0007`, see #39.
- **Workout page crashed with React error #310** (`4daa7a7`) — self-inflicted
  by `3a72dcf`, see #77. Every workout detail page was blank until the fix
  deployed.
- **Awards tab** (`c10aba8`) — `GET /awards`, Profile → Bio → Awards. Plate
  Club (absolute) + Relative Strength families, locked medals with progress,
  and streak history (best run with dates, current, total weeks at goal).
  `Medal.tsx` draws real struck medals in SVG — ribbon, milled rim, metal
  gradient, engraved value, five metals, distinct locked state. See #78, #80,
  #81, #82.

And a seventh batch — the logger stops round-tripping:

- **Optimistic set updates** — `SetRow`'s PATCH and DELETE now write the
  `['workout', id]` cache in `onMutate`, roll back from a snapshot in
  `onError`, and invalidate only when no sibling set mutation is still in
  flight. This was next-step #1 for good reason: every field commit and every
  checkbox tap previously waited for a PATCH *and* its refetch before the UI
  moved, which on gym wifi is the delay you actually feel mid-set. See #36 for
  the two invariants to preserve and the residual (the page's own mutations
  still invalidate unconditionally). Verified with a 27-assertion harness
  against a real `QueryClient`; **not yet rendered in the app** — the local
  stack needs Postgres and Redis, which weren't up.

And an eighth batch — the exercise library got editable:

- **Five new muscle groups** (migration `0008`) — `LATS`, `TRAPS`,
  `ADDUCTORS`, `ABDUCTORS`, `OBLIQUES`. The trigger was a machine hip adductor
  that had to be filed under HAMSTRINGS and a hip abductor under GLUTES, so
  their volume was being attributed to the wrong leg muscle. Chosen over a
  dynamic `muscle_groups` table with admin CRUD, deliberately: that would turn
  the compile-time `MuscleGroup` union into `string` across ~30 files and move
  labels and colours behind a query, to buy a capability with one user who
  controls the deploy. **Adding a group is still a code change** — see the
  Migrations section for the four places, one of which the compiler enforces.
- **Full exercise editor in admin** (`components/admin/ExerciseEditForm.tsx`) —
  name, category, primary muscle, secondary muscles and equipment. The panel
  previously offered only a *rename*, which was the right fix for a typo and
  no help at all for a mistagged muscle. The API already accepted every field;
  it was the UI that only ever sent `name`. In its own file rather than added
  to `admin/page.tsx`, which is already ~1,270 lines.
- **Delete a whole exercise from a workout** — `DELETE
  /workouts/:id/exercises/:exerciseId`, trash icon in the exercise header with
  an in-page confirm. One request instead of one per set, and the server also
  prunes `exerciseOrder` (#13) and dissolves a superset group left with one
  member. Optimistic, matching the set mutations.
- **Enum values stopped being rendered as labels** (#83) and **five
  hand-written copies of the exercise enums were deleted** (#84) — including
  the one that had lost `KETTLEBELL`.
- **`inferExerciseDetails` de-duplicated** into `lib/infer-exercise.ts` (#42),
  with keyword rules for the new groups and 44 assertions pinning the
  substring-ordering traps.
- **Calves appear on the trends chart.** `PRIMARY_MUSCLE_GROUPS` was a curated
  list and calves weren't on it, so a trained muscle simply didn't show. The
  chart's row set is now that list PLUS anything with sets this week or a
  target, so no future group needs adding here to become visible.
- **Superset routes got their missing ownership check** (#6b), noticed while
  adding the sibling endpoint.

## Current state

Deployed and in daily real use by the author against real workout data. The
Docker Hub images track `main` automatically; the Portainer stack is updated
by hand with "Pull and redeploy". Live host is `fittrackr.geehive.com` with
the API on `fittrackr-api.geehive.com`.

**The big redeploy happened and the author confirmed it working** (2026-09-02):
migrations `0006` and `0007` are applied, `/coach` and the Awards tab are live,
the program summary works, cardio mode persists, and the random-logout /
frozen-app fixes are in production. The two manual steps that redeploy needed
(PRs → Recalculate, and Training days per week) are done.

**Pending now: `0008_muscle_groups`, plus the eighth batch.** The migration is
applied by the entrypoint on the next redeploy. Until then the five new muscle
groups do not exist in the deployed database, so **the exercise editor's
dropdown will offer values the API rejects** — a 422 from the enum, not a
crash. In Portainer this is Stacks → the stack → **Update** with **"Re-pull
image and redeploy" ON** — without that toggle it recreates the containers from
the cached image and nothing changes. Then check the entrypoint actually
migrated:
`docker logs fittrackr-api-1 --since 5m 2>&1 | head -20` (see sharp edge #1
for why its failure path matters).

One manual pass after redeploying:

1. **Admin → Exercises → re-tag the mistagged machines.** The migration adds
   the muscle groups but changes no rows, deliberately. "Machine Hip Adductor"
   is still `HAMSTRINGS` and "Machine Hip Abductor" still `GLUTES`; the pencil
   now edits muscle, equipment and category. Their historical volume stays
   attributed to the old muscle — per-muscle tallies read `primaryMuscle` at
   query time, so re-tagging retroactively moves every past set too.

Known outstanding user-facing items:

- **Any passkey registered before commit `8cf1540` is dead** (old eTLD+1 rpId)
  and must be deleted and re-registered.
- **The splash screen will keep looking wrong until the PWA is reinstalled**
  (#58). The server is serving the correct file; this is purely iOS cache.
- **A workout may still carry a corrupt `durationMin`** from before `585c960`
  (the author had one reading ~29.8 million minutes). The validation stops it
  recurring but does not repair stored values — fix each with the duration
  pencil.
- Program generation's RPE curve plateaus rather than ramps (#62).
- **Neither of the last two batches has been rendered in the app.** Everything
  typechecks, `next build` compiles and generates all 19 pages, the API suite
  passes and the frontend logic is covered by harnesses (27 + 44 assertions) —
  but nothing was driven in a browser, because there is no local Postgres or
  Redis here and logging into the live stack was not an option. Specifically
  unproven by anything but a fake API:
  - the set checkbox ticking instantly, and a rejected patch visibly reverting
    (pull the wifi mid-set once);
  - the exercise-header trash → confirm → row disappears, and the superset
    case where removing one of two members dissolves the group;
  - the admin editor actually saving muscle/equipment/category, which needs
    `0008` deployed first or the new values 422.
- The program summary shows its empty state for every program that predates
  `0006` (#65). Correct, not broken — but worth seeing once.
- If logouts persist after the redeploy, the remaining suspect is **two
  clients** (installed PWA plus a browser tab) refreshing against each other:
  single-flight guards one JS context, not two.

## Next steps (not built, roughly by value)

0. **Redeploy for `0008`, re-tag the two hip machines, then confirm on a
   device** — see Current state. The new muscle groups do not exist in the
   deployed database yet, so the editor's dropdown offers values the API
   rejects until this happens.
1. ~~**Optimistic updates in the workout logger**~~ **DONE** for the set
   PATCH and DELETE and the whole-exercise delete (#36). What is left is the
   *page's* mutations — add set, add warmup, the warmup ladder, reorder.
   Add-set is the
   next one worth doing and the fiddliest: it needs a temp-id placeholder row,
   and `SetRow` must not be able to PATCH a temp id if the user types into it
   before the POST returns. Doing #2 first makes the ladder case tractable.
2. **A bulk set-create endpoint** (#76) so exercise replay and the warmup
   ladder are one request instead of N, and cannot partly succeed.
2b. **A frontend test runner.** `lib/streak.ts`, the duration helpers and the
   api-client refresh logic are only covered by throwaway harnesses. The
   React #310 crash (#77) would also have been caught by *any* render test —
   that is the gap that actually hurt.
3. **Make `docker-entrypoint.sh` fail hard** instead of falling through to
   `db push` and then starting anyway (sharp edge #1). Highest
   damage-per-effort item on the backend.
4. **Fix the CORS boundary check** (#6) — a one-line change to require a
   leading dot or an exact match — and **add an rpID allowlist** (#5).
4b. **Reach the exercise editor from the logger.** The editor exists but only
   in the admin panel, so noticing a mistagged exercise mid-workout means
   remembering to go and fix it later. `ExerciseEditForm` is standalone and
   the route is admin-only — this needs a non-admin
   `PATCH /exercises/:id` scoped to custom exercises, or an admin-gated
   shortcut, so decide which before building it.
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
15. **Have the AI emit absolute per-week RPE** instead of a monotonic delta
    (#62), so programs ramp and deload rather than plateauing at the cap.
16. **Draw the splash wordmark as vector paths** (#59) if the Segoe-UI-vs-SF-Pro
    difference on iOS ever matters. Would also make the splash independent of
    whatever fonts the generating machine happens to have.
17. **A shared unit-display helper** (#53). Three unit bugs have shipped from
    each component deciding conversion for itself. `formatDuration` in
    `lib/utils` is the pattern that worked for time — do the same for weight
    and distance: `formatWeight(kg, units)` plus a `useUnits()` hook. Every
    new page (summaries, coach, awards) has re-declared `LB_PER_KG` and its
    own converter, so the duplication is now five deep.
18. **Split `profile/page.tsx`** — it is past 2,100 lines and holds ~14
    components. `AwardsTab` was put in its own file rather than added to it;
    do that for the rest.
19. **More award families.** The medal machinery is generic — only the tier
    tables in `awards-rules.ts` decide what exists. Obvious additions: a
    bodyweight pull-up/dip family (reps rather than load), total-volume
    milestones, "logged N workouts". Each is one array entry plus a matcher
    test.
20. **Retire `emoji` from the award tiers.** It predates `Medal.tsx` and is
    now a fallback nothing renders — check nothing reads it off the API
    response first.

## Testing pattern used throughout

There is **no test framework and no working linter**, and exactly **one** test
file:

```bash
pnpm --filter @fittrackr/api test    # tsc, then each test/*.test.mjs
```

Three files, 146 assertions, plain node scripts with exit codes — no
framework, matching the project's zero-dependency habit:

- `test/program-expand.test.mjs` (48) — the AI program expander: rep-range
  shifting, RPE capping, deloads, malformed model output.
- `test/workout-summary.test.mjs` (45) — summary tallies: volume needing both
  weight and reps, cardio time/distance, bodyweight sets,
  best-set-by-volume, deltas.
- `test/awards-rules.test.mjs` (53) — benchmark matching (every variation that
  must NOT count), absolute vs relative tiers, the pounds comparison, and
  streak history.

Note the frontend has no suite at all: `lib/streak.ts`, `lib/utils.ts`'s
duration helpers and the api-client refresh logic are all verified with
throwaway harnesses (below) rather than anything that runs in CI. Moving those
into a real runner is the single biggest testing gap.

Both were written after a bug shipped in the code they cover. If you add pure
logic worth protecting, extend these or add a sibling file rather than
reaching for a framework — and remember to add it to the `test` script, which
chains the files explicitly.

**Frontend logic is verified with throwaway harnesses**, since none of it is
in a test runner. The pattern that has worked repeatedly: copy the pure part
of the logic into a scratchpad `.mjs`, model the thing it talks to, and assert
against the reported failure *plus* the cases that must still work. Recent
examples worth imitating rather than re-deriving:

- the rotating-refresh-token server, to prove 4 concurrent 401s refresh once
  and don't log out — while a genuinely dead token still does;
- `inferExerciseDetails` (#42), where the rules are ordered substring tests:
  the harness strips the TypeScript annotations off the real source and eval's
  it rather than copying the rules, so it tests the actual order, and every
  trap ("hip abductor" must not be core, "trap bar" must not be traps,
  "lateral raise" must not be lats) is an explicit negative assertion;
- the optimistic set mutations (#36), run against a **real** `QueryClient`
  imported from `node_modules` with a fake API whose latency and failures are
  controlled. Worth imitating: the uncertainty being tested was query-core's
  own semantics (does `isMutating` count the mutation that is settling?), not
  arithmetic, so modelling the library would have proved nothing. 27
  assertions, including that a slow patch's optimistic value survives a fast
  patch settling underneath it;
- the superset round gating (1-of-2 and 2-of-3 must NOT fire, uneven groups
  must not stall);
- corrupt persisted timer states, including the exact `496627:55:15` payload;
- the add-exercise fallback chain.

A guard that rejects everything, or a timer that never fires, passes a
one-sided test — always assert the negative case too.

Everything else is manual: build (`pnpm build` catches the TypeScript
strict-mode errors, which have broken CI more than once — see commits
`c387af7`, `31ec8d5`, `c64a332`, `dc6cbcf`, `273dfae`), then drive the real UI,
usually on a phone, against the deployed stack.

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
  splash change; nothing runs it for you. **Look at the rendered PNG
  afterwards** — a font that fails to resolve (#60) or a sliver of bar showing
  between plates are both invisible in the source and obvious in the output.
- **When a fix "doesn't work", check what is actually deployed before
  changing more code.** Two long detours this session came from not doing
  that: an empty log grep that was really a wrong container name, and a
  splash "bug" that was iOS cache over a correct file. `curl` the asset,
  compare the byte count to the committed file, and check
  `gh run list -R stevegee006/FitTrackr` for the build.
- Beware the workspace tooling hazards in #63 — bare `git`, `gh`, and
  `preview_start` can all silently address the *MacroTracker* project instead.
