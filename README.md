# FlowDesk — WhatsApp Task Manager

A full-stack task management system where tasks are assigned through a web dashboard and employees interact entirely via **WhatsApp** — marking tasks done, reporting issues, sending photo proof, and receiving escalation alerts.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL (Neon serverless) via Prisma ORM |
| WhatsApp | Meta WhatsApp Cloud API |
| Media storage | Cloudinary |
| Auth | JWT (bcrypt password hashing) |

---

## Architecture

```
Admin/Manager (web dashboard)
        │  creates task
        ▼
  POST /api/tasks  ──►  Prisma → Neon PostgreSQL
        │
        ▼
  sendWhatsApp()  ──►  Meta Graph API  ──►  Employee's WhatsApp
                                                    │
                                          replies "TSK-1054 done,
                                          mirrors installed" + photo
                                                    │
                                                    ▼
                               Meta  ──►  POST /api/webhook
                                                    │
                                     ┌──────────────┴────────────────┐
                                     │  parse text  │  download image │
                                     │  update DB   │  → Cloudinary   │
                                     └──────────────┴────────────────┘
                                                    │
                                         task.status = Done
                                         activity.mediaUrl = CDN URL
                                                    │
                              Frontend polls every 30s → UI updates
                              Notifications poll every 5s → bell icon
```

---

## Features

### Web Dashboard
- **Admin** — full access: create tasks for anyone, view all org data, approve/retract
- **Manager** — create tasks for direct reports, approve/reject completions
- **Employee** — view own tasks, update status via dashboard or WhatsApp
- Org chart with hierarchy (drives escalation routing)
- Add team members with WhatsApp number + reporting structure
- Task detail modal: activity feed, WhatsApp thread (real chat bubbles), image thumbnails
- Bell notifications with 5-second polling, colour-coded by type

### WhatsApp Flow
Employees reply to the notification number:

| Reply | Action |
|---|---|
| `TSK-1054 done` | Mark task Done |
| `TSK-1054 done, mirrors installed` | Mark Done + log comment |
| `TSK-1054 issue gateway is down` | Set status to Issue + log |
| `TSK-1054 delay need 2 more days` | Set status to Delay |
| `(image only, no text)` | Attach photo to most recent task |
| `(image + caption)` | Attach photo + parse status from caption |

### Escalation Engine
- Cron runs every 15 minutes
- Overdue tasks auto-escalate (increment `escalationLevel`)
- Assignee notified via WhatsApp
- If already escalated once, manager also notified

---

## Project Structure

```
├── backend/                        # Express + TypeScript API
│   ├── prisma/
│   │   ├── schema.prisma           # DB models: User, Task, Activity
│   │   └── seed.ts                 # Seed 11 users + 12 tasks
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── taskController.ts        # CRUD + approve/retract/escalate
│   │   │   ├── userController.ts        # User management + readable ID gen
│   │   │   ├── webhookController.ts     # Inbound WhatsApp parser
│   │   │   └── notificationController.ts
│   │   ├── services/
│   │   │   ├── whatsappService.ts       # Meta Graph API sender + template fallback
│   │   │   ├── mediaService.ts          # Meta download → Cloudinary upload
│   │   │   └── escalationService.ts     # Cron escalation logic
│   │   ├── routes/                 # Express routers
│   │   ├── middleware/             # JWT auth + role guard
│   │   └── workers/               # node-cron scheduler (every 15 min)
│   └── .env.example
│
├── src/                            # React frontend
│   ├── components/
│   │   ├── TaskDetailsModal.jsx    # Activity feed + real WhatsApp thread
│   │   ├── CreateTaskModal.jsx
│   │   ├── AddMemberModal.jsx      # Add member with hierarchy + WhatsApp number
│   │   └── NotificationsPanel.jsx  # Bell notifications
│   ├── context/
│   │   └── AppContext.jsx          # Global state, API polling, addUser/addTask
│   ├── views/
│   │   ├── AdminDashboard.jsx
│   │   ├── TasksView.jsx
│   │   ├── TeamView.jsx
│   │   └── ...
│   └── lib/
│       ├── api.js                  # Typed fetch wrapper (Bearer token)
│       └── auth.js                 # JWT localStorage helpers
└── README.md
```

---

## Setup

### 1 — Clone & install

```bash
git clone https://github.com/SahilShrivastava-Dev/flowdesk.git
cd flowdesk

# Frontend dependencies
npm install

# Backend dependencies
cd backend && npm install
```

### 2 — Environment variables

**`backend/.env`** (copy from `backend/.env.example`):

```env
PORT=5005
DATABASE_URL="postgresql://..."

JWT_SECRET="your-long-random-secret"
JWT_EXPIRES_IN="7d"

# Meta WhatsApp Cloud API
META_PHONE_ID="your_phone_number_id"
META_ACCESS_TOKEN="EAAxxxxx..."
META_VERIFY_TOKEN="flowdesk-webhook-secret"
# Set "true" once task_assignment + task_escalation templates approved by Meta
META_TEMPLATES_APPROVED="false"

# Cloudinary — for WhatsApp image/doc attachments
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"

FRONTEND_URL="http://localhost:5173"
```

**`src/.env.development`**:

```env
VITE_API_URL=http://localhost:5005
```

### 3 — Database

```bash
cd backend
npx prisma db push     # apply schema to Neon
npx prisma db seed     # seed 11 demo users + 12 tasks
```

Default password for all seeded users: `flowdesk123`

| Email | Role |
|---|---|
| aarav@flowdesk.io | Admin |
| priya@flowdesk.io | Manager |
| sneha@flowdesk.io | Employee |

### 4 — Run

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend  
npm run dev
```

Frontend → http://localhost:5173  
Backend  → http://localhost:5005/api/health

### 5 — WhatsApp webhook (to receive replies)

```bash
ngrok http 5005
# Copy the https URL, e.g. https://abc123.ngrok-free.app
```

In Meta developer dashboard → WhatsApp → Configuration:
- **Callback URL**: `https://abc123.ngrok-free.app/api/webhook`
- **Verify token**: `flowdesk-webhook-secret`
- **Subscribe to**: `messages`

Subscribe your WABA (run once):
```bash
curl -X POST \
  "https://graph.facebook.com/v19.0/{WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## WhatsApp Message Templates

Create in Meta Business Manager → WhatsApp → Message Templates:

**`task_assignment`** (Category: Utility)
```
You've been assigned a new task:

*{{1}}*
Deadline: {{2}}

Reply with:
• *done* — mark as complete
• *delay* — request more time
• *issue <reason>* — flag a problem
```

**`task_escalation`** (Category: Utility)
```
⚠️ Overdue task alert:

Hi {{1}}, your task *{{2}}* is past its deadline.

Reply immediately:
• *done* — if complete
• *delay* — to request more time
• *issue <reason>* — to flag a blocker
```

Once approved → set `META_TEMPLATES_APPROVED="true"` in `.env`. No code changes needed.

---

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | — | Get JWT token |
| GET | `/api/users` | JWT | List users (role-filtered) |
| POST | `/api/users` | Admin | Create user (auto-generates readable ID) |
| GET | `/api/tasks` | JWT | List tasks (role-filtered) |
| POST | `/api/tasks` | Admin/Manager | Create task + send WhatsApp |
| PATCH | `/api/tasks/:id` | JWT | Edit task fields |
| POST | `/api/tasks/:id/status` | JWT | Update status |
| POST | `/api/tasks/:id/approve` | Admin/Manager | Approve (one-time) |
| POST | `/api/tasks/:id/retract` | Admin/Manager | Retract approval |
| POST | `/api/tasks/:id/reject` | Admin/Manager | Reject — needs rework |
| POST | `/api/tasks/:id/escalate` | JWT | Manual escalation |
| POST | `/api/tasks/:id/reassign` | Admin/Manager | Reassign to new user |
| GET | `/api/webhook` | — | Meta webhook verification |
| POST | `/api/webhook` | — | Inbound WhatsApp messages |
| GET | `/api/notifications` | JWT | Activity-based bell notifications |

---

## Deployment (Render)

`backend/render.yaml` is pre-configured. To deploy:

1. Push to GitHub
2. Connect repo on [render.com](https://render.com) → select `backend/render.yaml`
3. Add all env vars in Render dashboard
4. Update Meta webhook Callback URL to the Render service URL
5. Frontend → deploy to Vercel, set `VITE_API_URL` to Render URL

---

## Key Engineering Notes

| Topic | Detail |
|---|---|
| **Readable IDs** | `U108`, `TSK-1054` generated by querying max existing ID at insert time |
| **`alertDispatched` flag** | Prevents 48h reminder from duplicating the immediate creation alert |
| **Buffer parsing** | `express.raw()` returns a Node Buffer; webhook explicitly handles Buffer / string / object |
| **Phone matching** | Last 10 digits used (`LIKE %...%`) so `+91 98765 43210` matches Meta's `919876543210` |
| **Template fallback** | `META_TEMPLATES_APPROVED=false` → all sends use pre-approved `hello_world` |
| **Cloudinary `resource_type: auto`** | Single upload path handles images, videos, and documents |
| **Approval guard** | `canApprove` checks `!task.approved` — prevents double-approval spam |
| **Image-only WhatsApp** | No-caption images attach to most recently active task within 7 days |
