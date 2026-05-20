# FlowDesk — Setup & Deployment Guide

## Local Development (no WhatsApp)

### 1. Database — Neon

1. Create a free project at https://neon.tech
2. Copy the **connection string** (looks like `postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require`)

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env — fill in DATABASE_URL and JWT_SECRET (any long random string)
# Leave META_* empty for now (WhatsApp works without them)

npm install
npx prisma db push          # creates tables on Neon
npx ts-node prisma/seed.ts  # seeds demo users + tasks
npm run dev                  # starts on port 5000
```

Test: `curl http://localhost:5000/api/health` → `{"ok":true}`

### 3. Frontend

```bash
# In the root directory (Task-Manager/)
npm install
# .env.development already points to http://localhost:5000
npm run dev                  # starts on port 5173
```

Open http://localhost:5173 — you'll see the login screen.

**Demo credentials (seeded by seed.ts):**

| Role | Email | Password |
|---|---|---|
| Admin | aarav@flowdesk.io | flowdesk123 |
| Manager | priya@flowdesk.io | flowdesk123 |
| Employee | sneha@flowdesk.io | flowdesk123 |

---

## WhatsApp Integration (Meta Cloud API)

### Prerequisites
- A Meta Developer account
- A WhatsApp Business number (can be a test number in the sandbox)

### Steps

1. Go to https://developers.facebook.com → Create App → Business type
2. Add **WhatsApp** product
3. Note your **Phone Number ID** and generate a **temporary access token**
4. In `backend/.env`:
   ```
   META_PHONE_ID=your_phone_number_id
   META_ACCESS_TOKEN=EAADxxx...
   META_VERIFY_TOKEN=flowdesk-webhook-secret
   ```

5. **Expose your local backend** for webhook testing:
   ```bash
   npx localtunnel --port 5000
   # or use ngrok: ngrok http 5000
   ```

6. In Meta Developer Console → WhatsApp → Configuration:
   - Webhook URL: `https://your-tunnel.loca.lt/api/webhook`
   - Verify Token: `flowdesk-webhook-secret` (matches `META_VERIFY_TOKEN`)
   - Subscribe to: `messages`

7. **Submit two message templates** for Meta approval:
   - `task_assignment`: "New task assigned: {{1}}. Deadline: {{2}}. Reply 'Done', 'Issue', or 'Delay'."
   - `task_escalation`: "Alert: {{1}} has missed the deadline for {{2}}."

8. Add employee phone numbers in the Admin dashboard user management, or directly in DB:
   ```sql
   UPDATE "User" SET phone = '919876543210' WHERE email = 'sneha@flowdesk.io';
   ```

---

## Production Deployment

### Backend → Render

1. Push code to GitHub
2. Go to https://render.com → New Web Service → Connect GitHub repo
3. Settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npx prisma generate && npm run build`
   - **Start Command:** `node dist/index.js`
4. Add environment variables (from `backend/.env.example`)
5. After first deploy, run seed: **Render Shell** → `npx ts-node prisma/seed.ts`

### Frontend → Vercel

1. Already configured with `vercel.json` / Vercel project
2. Add environment variable in Vercel dashboard:
   - `VITE_API_URL` = `https://your-render-service.onrender.com`
3. `npm run deploy` or push to main branch

### Update CORS

In `backend/.env` (or Render env vars):
```
FRONTEND_URL=https://task-manager-three-orcin.vercel.app
```

---

## Architecture recap

```
Frontend (Vercel)     →  HTTPS/JSON  →  Backend (Render)
React 18 + Vite                          Node.js + Express + TypeScript
                                              ↓
                                         Neon PostgreSQL
                                         (via Prisma ORM)
                                              ↓
                                      Meta WhatsApp Cloud API
                                      (outbound: task assignments)
                                      (inbound: webhook at /api/webhook)
                                              ↓
                                         node-cron
                                      (auto-escalation every 15 min)
```

## File overview

```
Task-Manager/
├── src/                    Frontend (React + Vite)
│   ├── lib/api.js          Base fetch wrapper (JWT auth header)
│   ├── lib/auth.js         Token storage helpers
│   ├── context/AppContext  Global state + API mutations
│   └── views/LoginView     Login screen
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma   DB schema (User, Task, Activity)
│   │   └── seed.ts         Demo data seeder
│   └── src/
│       ├── index.ts        Express entry
│       ├── routes/         auth, users, tasks, webhook
│       ├── controllers/    authController, userController,
│       │                   taskController, webhookController
│       ├── services/       whatsappService, escalationService
│       ├── workers/        scheduler.ts (node-cron)
│       └── middleware/     auth.ts (JWT), roleGuard.ts (RBAC)
├── .env.development        VITE_API_URL=http://localhost:5000
└── SETUP.md                This file
```
