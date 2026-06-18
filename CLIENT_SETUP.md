# Client Setup / Onboarding Guide

How to deploy FlowDesk for a **new client** (new database, new backend, new branded
frontend) from the **same** codebase. Uses **"TDM"** as the running example —
replace it with the real client everywhere you see it.

---

## The one big idea

You do **NOT** copy or fork the code. The code stays as a single GitHub repo.
For each client you spin up a **separate set of running instances** from that
*same* code. They differ only in (a) their **environment variables** and
(b) their **own database**.

> Think of the code as one recipe. Each client is the same recipe cooked in their
> own kitchen, with their own ingredients.

So a new client = **3 separate things**, all built from the same repo:

| # | Piece     | What it is for the client        | What differs            |
|---|-----------|----------------------------------|-------------------------|
| 1 | Database  | Client's own Neon Postgres       | New `DATABASE_URL`      |
| 2 | Backend   | New Render Web Service (same repo) | Client's backend env vars |
| 3 | Frontend  | New Firebase Hosting site (same repo) | Client's `VITE_*` vars  |

Your existing CaratSense demo keeps running, untouched, the whole time.

---

## Before you start

- Access to the client's accounts (or your own, dedicated to them): **Neon**
  (database) and — only if WhatsApp is used now — a **Meta** developer app.
- The GitHub repo connected to Render (`CaratSenseAI/FlowDesk`).
- `firebase-tools` and the project's Node toolchain installed locally.
- Decide the client's **Firebase site name** up front (e.g. `flowdesk-tdm`),
  because the backend needs that URL before the frontend is even deployed.

---

## Step 1 — Create the client's database

You need a database URL before anything else can connect.

1. Log into **Neon** (https://neon.tech) with the client's credentials.
2. Create a **new project** → copy the **connection string**. It looks like:
   ```
   postgresql://user:password@host/dbname?sslmode=require
   ```
   This is the client's `DATABASE_URL`. You'll load tables into it in Step 3.

---

## Step 2 — Create the client's backend on Render

1. In Render → **New → Web Service** → connect the **same GitHub repo**
   (`CaratSenseAI/FlowDesk`).
2. Render reads `backend/render.yaml`, so the build/start commands are already
   correct. Name the service, e.g. `tdm-api`.
3. Set the **environment variables** with the client's values (this is the only
   thing that differs per client — see the full reference table below):
   - **Required:** `DATABASE_URL` (from Step 1), `JWT_SECRET` (let Render generate),
     `FRONTEND_URL` (set to the client's Firebase URL you chose, e.g.
     `https://flowdesk-tdm.web.app` — needed so the browser is allowed to call
     the API / CORS).
   - **WhatsApp (only if used now):** `META_PHONE_ID`, `META_ACCESS_TOKEN`,
     `META_VERIFY_TOKEN`, `META_TEMPLATES_APPROVED=false`.
   - **Optional helpers (reuse yours or create the client's):** `CLOUDINARY_*`,
     `GROQ_API_KEY`, `ANTHROPIC_API_KEY`.
4. Deploy. Render gives you a URL like `https://tdm-api.onrender.com`.
   **Copy it** — the frontend needs it in Step 4.

---

## Step 3 — Load the tables into the client's database

The new database is empty. From your machine, point Prisma at the client's DB and
create the tables:

```bash
cd backend
DATABASE_URL="<client's Neon string>" npx prisma db push
DATABASE_URL="<client's Neon string>" npm run db:seed   # optional starter/sample data
```

> Skip `db:seed` if the client should start with a clean, empty system rather than
> the demo users/tasks. No data is moved from CaratSense — each client starts fresh.

---

## Step 4 — Build & deploy the client's frontend to its own Firebase site

1. Create a new Firebase Hosting site named e.g. **`flowdesk-tdm`** — this produces
   the `flowdesk-tdm.web.app` URL (the same one you set as `FRONTEND_URL` in Step 2).
2. Build the frontend with the client's values:
   ```bash
   VITE_API_URL=https://tdm-api.onrender.com \
   VITE_ORG_NAME="TDM" \
   VITE_ORG_ID="TDM-2026-OPS" \
   npm run build
   ```
   *(Alternatively, put these three lines in a `.env.production` file before
   building — it is gitignored, so client values never get committed.)*
3. Deploy to the client's site only:
   ```bash
   firebase deploy --only hosting:flowdesk-tdm
   ```

Done — `flowdesk-tdm.web.app` now runs the same app, branded "TDM", talking to the
client's backend and the client's database. CaratSense is unaffected.

---

## Environment variable reference

### Backend (set in Render → the client's service)

| Variable | Required? | What it is |
|----------|-----------|------------|
| `DATABASE_URL` | ✅ | Client's Neon Postgres connection string |
| `JWT_SECRET` | ✅ | Long random string for signing login tokens (Render can generate) |
| `JWT_EXPIRES_IN` | – | Token lifetime, e.g. `7d` |
| `FRONTEND_URL` | ✅ | Client's frontend origin for CORS, e.g. `https://flowdesk-tdm.web.app` |
| `NODE_ENV` | – | `production` (set by render.yaml) |
| `META_PHONE_ID` | WhatsApp | Client's WhatsApp phone number ID (Meta) |
| `META_ACCESS_TOKEN` | WhatsApp | Client's Meta access token |
| `META_VERIFY_TOKEN` | WhatsApp | Webhook verify token (must match Meta dashboard) |
| `META_TEMPLATES_APPROVED` | WhatsApp | `false` until Meta approves the message templates |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | optional | Media storage for WhatsApp attachments |
| `GROQ_API_KEY` | optional | Voice-note transcription (free tier) |
| `OPENAI_API_KEY` | optional | Fallback transcription if no Groq key |
| `ANTHROPIC_API_KEY` | optional | Semantic intent detection for voice notes |

### Frontend (set at build time — `.env.production` or inline env vars)

| Variable | Required? | What it is |
|----------|-----------|------------|
| `VITE_API_URL` | ✅ | Client's Render backend URL. Leave empty for demo mode (mock data) |
| `VITE_ORG_NAME` | – | Display name in the dashboard header. Falls back to `FlowDesk` |
| `VITE_ORG_ID` | – | Reference ID under the header (with copy button). Empty hides it |

---

## Verification checklist

- [ ] Backend health check responds: `https://tdm-api.onrender.com/api/health`
- [ ] Frontend loads at the client's Firebase URL and the header shows the client's name
- [ ] Login works (talks to the client's backend, not CaratSense's)
- [ ] Data shown comes from the client's database (empty/seed as expected)
- [ ] (If WhatsApp) Meta webhook points to the client's Render URL and verifies
- [ ] CaratSense demo still works and is unchanged

---

## Notes

- **Code changes per client:** for a name-only customization, **none** — it's all
  env vars. Touch code only for client-specific *features* (extra fields, different
  workflow), handled as separate work.
- **Secrets never get committed.** Client values live only in Render's dashboard and
  in the local, gitignored `.env.production` / `backend/.env`. See `.env.example`
  (frontend) and `backend/.env.example` for the documented templates.
- **One repo, many clients.** Repeat Steps 1–4 per client. Each gets its own database,
  Render service, and Firebase site; they never share data.
