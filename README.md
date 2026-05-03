<p align="center">
  <img src="packages/web/public/logo.svg" alt="FitTrackr Logo" width="100" />
</p>

<h1 align="center">FitTrackr</h1>

<p align="center">
  <strong>Self-hosted, privacy-first workout & training tracker</strong><br>
  AI programs &bull; Volume tracking &bull; Installable PWA
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-6366f1?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/PWA-installable-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="PWA" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js_15-black?style=flat-square&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Fastify_5-202020?style=flat-square&logo=fastify" alt="Fastify" />
  <img src="https://img.shields.io/badge/PostgreSQL_17-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis_7-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/Prisma_6-2D3748?style=flat-square&logo=prisma" alt="Prisma" />
</p>

---

## What is FitTrackr?

A complete workout tracking app you host yourself. Log sets, track volume by muscle group, and let AI generate personalized training programs — all with your data staying on your server.

### Highlights

- **Workout Logging** — Log sets with weight, reps, RPE, and rest timers in a guided session flow
- **Volume Rings** — Interactive dashboard showing weekly training volume per muscle group
- **AI-Powered** — Generate custom training programs, analyze exercise form, or ask training questions with OpenAI, Anthropic, or Gemini (bring your own key)
- **Exercise Library** — Searchable database with muscle group targeting, equipment filters, and custom exercises
- **Training Programs** — Multi-week structured programs with auto-progression and AI generation
- **Body Tracking** — Weight, body fat %, measurements with trend charts
- **Progress Photos** — Encrypted photo storage with lightbox viewer
- **PWA** — Install on any device, works offline

---

## Quick Start

### Option A: Docker Compose (Recommended)

Pre-built images from Docker Hub — no build step required.

**1. Create project directory**

```bash
mkdir fittrackr && cd fittrackr
```

**2. Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: fittrackr
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
      POSTGRES_DB: fittrackr
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fittrackr"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    image: geaves006/fittrackr-api:latest
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://fittrackr:${POSTGRES_PASSWORD:-changeme}@db:5432/fittrackr
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      FRONTEND_URL: ${FRONTEND_URL:-http://localhost:3000}
      API_BASE_URL: ${API_BASE_URL:-http://localhost:4000}
      API_PORT: 4000
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
    ports:
      - "${API_PORT:-4000}:4000"

  web:
    image: geaves006/fittrackr-web:latest
    restart: unless-stopped
    depends_on:
      - api
    environment:
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:4000/api/v1}
    ports:
      - "${WEB_PORT:-3000}:3000"

volumes:
  pg_data:
  redis_data:
```

**3. Create `.env`**

```env
# Required — generate with: openssl rand -hex 32
JWT_SECRET=<random-string-at-least-32-chars>
JWT_REFRESH_SECRET=<another-random-string>
ENCRYPTION_KEY=<64-hex-char-string-for-aes-256>
POSTGRES_PASSWORD=<strong-db-password>

# URLs — change for production / reverse proxy
FRONTEND_URL=http://localhost:3000
API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1

# Optional — Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

> **Tip:** Generate all secrets at once:
> ```bash
> echo "JWT_SECRET=$(openssl rand -hex 32)"
> echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
> echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
> echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
> ```

**4. Start**

```bash
docker compose up -d
```

Open `http://localhost:3000` and create your account.

**Update to latest:**

```bash
docker compose pull && docker compose up -d
```

---

### Option B: Portainer Stack

If you use Portainer to manage Docker:

1. Go to **Stacks** > **Add stack**
2. Name it `fittrackr`
3. Paste the `docker-compose.yml` contents from above into the **Web editor**
4. Scroll down to **Environment variables** and add each `.env` variable:

   | Name | Value |
   |------|-------|
   | `JWT_SECRET` | *(output of `openssl rand -hex 32`)* |
   | `JWT_REFRESH_SECRET` | *(output of `openssl rand -hex 32`)* |
   | `ENCRYPTION_KEY` | *(output of `openssl rand -hex 32`)* |
   | `POSTGRES_PASSWORD` | *(strong password)* |
   | `FRONTEND_URL` | `https://fit.yourdomain.com` |
   | `API_BASE_URL` | `https://fit-api.yourdomain.com` |
   | `NEXT_PUBLIC_API_URL` | `https://fit-api.yourdomain.com/api/v1` |

5. Click **Deploy the stack**

> **Updating:** In Portainer, go to your stack > click **Pull and redeploy** to grab the latest images.

---

## Features

<table>
<tr>
<td width="50%">

### Tracking
- Workout session logging with rest timers
- Sets: weight × reps, bodyweight, duration, distance
- RPE (Rate of Perceived Exertion) per set
- Exercise swap mid-session
- Supersets & circuit support
- Workout export (CSV)

</td>
<td width="50%">

### AI-Powered
- Personalized training program generation
- Multi-week progressive overload programs
- Exercise form & technique Q&A
- Training load recommendations
- Multi-provider: OpenAI, Anthropic, Gemini
- Bring your own API key (encrypted at rest)

</td>
</tr>
<tr>
<td>

### Body & Progress
- Weight tracking with auto-sync to profile
- Body measurements (12 body parts)
- Body fat % and lean mass tracking
- Progress photos (encrypted storage)
- Trend charts (training volume + body)
- Streak tracking

</td>
<td>

### User Experience
- Progressive Web App (installable)
- Dark mode (system-aware + manual)
- Imperial & metric units
- Guided onboarding tutorial
- Volume rings dashboard (per muscle group)
- Training goal weekly targets
- Passkey authentication support

</td>
</tr>
</table>

---

## Tech Stack

| Layer | Technology |
|:------|:-----------|
| **Frontend** | Next.js 15 (App Router), React 19, Tailwind CSS 4, TanStack Query v5 |
| **Backend** | Fastify 5, Prisma 6, PostgreSQL 17, Redis 7 |
| **AI** | OpenAI, Anthropic, Google Gemini (user-provided keys) |
| **Auth** | JWT (access + refresh), Google OAuth, Passkeys (WebAuthn) |
| **PWA** | @serwist/next (service worker, precaching, offline shell) |
| **Monorepo** | pnpm 10 workspaces, Turborepo |
| **Deploy** | Docker Compose, GitHub Actions CI/CD |

---

## Architecture

```
                    ┌──────────────┐
                    │   Browser    │
                    │  (PWA/Web)   │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
       ┌──────▼──────┐          ┌──────▼──────┐
       │  Next.js 15 │          │  Fastify 5  │
       │   :3000     │          │   :4000     │
       │  (frontend) │─────────▶│   (API)     │
       └─────────────┘          └──────┬──────┘
                                       │
                          ┌────────────┼────────────┐
                          │            │            │
                   ┌──────▼───┐ ┌─────▼────┐ ┌─────▼─────┐
                   │ Postgres │ │  Redis   │ │ AI APIs   │
                   │   :5432  │ │  :6379   │ │ (OpenAI,  │
                   │  (data)  │ │ (cache/  │ │ Anthropic,│
                   └──────────┘ │  tokens) │ │ Gemini)   │
                                └──────────┘ └───────────┘
```

---

## Project Structure

```
FitTrackr/
├── packages/
│   ├── shared/            # Types, Zod schemas, constants
│   ├── api/               # Fastify backend
│   │   ├── prisma/        #   Schema & migrations
│   │   └── src/
│   │       ├── plugins/   #   Auth, Prisma, Redis
│   │       ├── routes/    #   API route handlers
│   │       ├── services/  #   Business logic
│   │       └── utils/     #   Encryption, errors, helpers
│   └── web/               # Next.js frontend
│       └── src/
│           ├── app/       #   Route groups: (auth), (dashboard)
│           ├── components/ #   UI, workout logger, exercise search
│           ├── providers/  #   Auth, Query, Theme providers
│           └── lib/       #   API client, utilities
├── docker-compose.yml
├── docker-compose.dev.yml
└── turbo.json
```

---

## Development Setup

### Prerequisites

- [Node.js 22+](https://nodejs.org/)
- [pnpm 10+](https://pnpm.io/)
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)

### Getting started

```bash
git clone https://github.com/geaves006/fittrackr.git
cd FitTrackr
pnpm install
cp .env.example .env   # Edit with your secrets
```

### Run with Docker (build from source)

```bash
docker compose up --build
```

### Run with hot reload

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Run without Docker

Start PostgreSQL and Redis separately, then:

```bash
pnpm db:migrate    # Run Prisma migrations
pnpm db:seed       # Seed exercise library (optional)
pnpm dev           # Start all services via Turborepo
```

### Commands

| Command | Description |
|:--------|:------------|
| `pnpm dev` | Start all packages in dev mode |
| `pnpm build` | Build all packages |
| `pnpm lint` | Lint all packages |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:push` | Push schema to database |
| `pnpm db:seed` | Seed exercise library |
| `pnpm db:studio` | Open Prisma Studio GUI |

---

## Database Models

| Model | Description |
|:------|:------------|
| **User** | Auth credentials, display name, OAuth/passkey providers |
| **UserProfile** | Height, weight, age, sex, activity level, training goal |
| **UserSettings** | Encrypted AI keys, preferred provider, units, dark mode, timezone |
| **Exercise** | Name, category, primary/secondary muscles, equipment, instructions |
| **Workout** | Session with date, duration, notes |
| **WorkoutSet** | Weight, reps, RPE, set type (normal/warmup/dropset) |
| **Program** | Multi-week training plan with scheduled workouts |
| **TrainingGoal** | Weekly volume targets per muscle group |
| **BodyMeasurement** | Weight, body fat %, lean mass, 12 circumference measurements |
| **ProgressPhoto** | Encrypted file paths, date, notes |

---

## CI/CD

GitHub Actions automatically builds and pushes Docker images on every push to `main`:

| Image | Description |
|:------|:------------|
| `geaves006/fittrackr-api:latest` | Fastify API (runs migrations on startup) |
| `geaves006/fittrackr-web:latest` | Next.js standalone build |

---

## License

MIT
