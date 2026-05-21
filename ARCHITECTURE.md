# FlowDesk — Product Architecture & Delivery Documentation

> **Prepared for:** Client delivery and onboarding  
> **Status:** V1 — Production-ready core, active development  
> **Repository:** https://github.com/SahilShrivastava-Dev/flowdesk (private)

---

## 1. What Is FlowDesk?

FlowDesk is a **WhatsApp-native task management system** built for field-service and operations businesses. It bridges the gap between a manager's web dashboard and an employee who is on the ground — with no app to download, no portal to log into.

### The problem it solves

Traditional task software assumes everyone sits at a desk with a laptop. In field service, retail, logistics, and home services most employees:
- Don't use laptops
- Won't adopt a new app
- Already have WhatsApp open all day

FlowDesk makes WhatsApp the primary interface for employees. Managers and admins run everything from a web dashboard. The two systems talk to each other automatically.

### Core loop

```
Manager creates task (web dashboard)
         ↓
Employee receives WhatsApp notification
         ↓
Employee replies: "done", "issue", "delay" + optional photo
         ↓
System updates task status, logs activity, notifies manager
         ↓
Manager approves, escalates, or reassigns from dashboard
```

---

## 2. Who Uses It — The Three Roles

| Role | Primary tool | What they do |
|---|---|---|
| **Admin** | Web dashboard | Full system access. Creates tasks for anyone, manages team hierarchy, configures escalation, approves work, views analytics |
| **Manager** | Web dashboard | Creates tasks for their direct reports, approves/rejects completions, escalates issues to Admin |
| **Employee** | WhatsApp only | Receives task via WhatsApp, replies with status updates and photo proof, gets escalation alerts |

The hierarchy is not just organisational — it drives the entire escalation and notification routing engine.

---

## 3. Current Architecture

### 3.1 High-level system diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT BROWSER                          │
│  React SPA (Vite + Tailwind)                                │
│  Admin Dashboard · Manager Dashboard · Employee Dashboard   │
│  Tasks · Team · Timeline · Tracker · Analytics              │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS REST API (JWT auth)
┌──────────────────────────▼──────────────────────────────────┐
│                    BACKEND (Node.js / Express / TypeScript)  │
│                                                              │
│  Routes: /api/auth  /api/tasks  /api/users                  │
│          /api/notifications  /api/whatsapp  /api/webhook     │
│                                                              │
│  Services:                                                   │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ WhatsApp Service │  │  Escalation Cron │                 │
│  │ (Meta Graph API) │  │  (node-cron 15m) │                 │
│  └──────────────────┘  └──────────────────┘                 │
│  ┌──────────────────┐                                        │
│  │  Media Service   │                                        │
│  │  (Cloudinary)    │                                        │
│  └──────────────────┘                                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ Prisma ORM
┌──────────────────────────▼──────────────────────────────────┐
│              DATABASE — Neon (PostgreSQL serverless)         │
│   Users · Tasks · Activities                                 │
└─────────────────────────────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     Meta WhatsApp    Cloudinary      ngrok / Render
     Cloud API        (media CDN)     (webhook tunnel)
     (send & receive)
```

### 3.2 Technology stack

| Layer | Technology | Why chosen |
|---|---|---|
| Frontend | React 18 + Vite | Fast HMR, component model, ecosystem |
| Styling | Tailwind CSS | Utility-first, easy theming, no CSS files |
| Backend | Node.js + Express + TypeScript | Lightweight, typed, fast to iterate |
| ORM | Prisma | Type-safe DB queries, easy migrations |
| Database | PostgreSQL (Neon serverless) | Reliable, free tier, scales on demand |
| WhatsApp | Meta WhatsApp Cloud API | Official BSP API, no third-party dependency |
| Media storage | Cloudinary | Auto-format images, free 25GB tier |
| Auth | JWT + bcrypt | Stateless, no session DB needed |
| Scheduler | node-cron | Lightweight, in-process, no Redis needed |
| Deployment | Render (backend) + Vercel (frontend) | Git push deploy, free tier available |

### 3.3 Data model

```
User
  id            (U001, U108 — readable sequential)
  name, email, passwordHash
  role          Admin | Manager | Employee
  reportingToId → User (self-referential tree — drives escalation routing)
  phone         (WhatsApp E.164 number — REQUIRED for alerts)
  avatar, color

Task
  id            (TSK-1054 — readable sequential)
  title, description
  assignedToId  → User
  assignedById  → User
  status        Pending | Done | Issue | Delay
  priority      Low | Medium | High
  deadline      DateTime
  escalationLevel  Int (0 = not escalated, increments per level)
  approved      Boolean
  alertDispatched  Boolean (prevents duplicate 48h reminders)
  customFields  JSON (flexible key-value pairs per task)

Activity   (complete audit trail)
  taskId    → Task
  byId      → User
  type      created | status | escalation | approval | retract |
             reject | reassign | whatsapp | outbound | comment
  text      Human-readable description
  mediaUrl  Cloudinary URL (for WhatsApp image/video attachments)
```

### 3.4 WhatsApp message flow

```
OUTBOUND (system → employee)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task created          → task_assignment template  (title + deadline)
Task escalated        → task_escalation template  (name + title)
48h before deadline   → task_assignment template  (reminder)
Admin sends message   → Free text (if within 24h session window)
                      → hello_world template (if session expired)

INBOUND (employee → system, via webhook)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"TSK-1054 done, mirrors installed"   → status = Done + comment logged
"TSK-1054 issue customer not home"   → status = Issue + comment logged
"TSK-1054 delay need 2 more days"    → status = Delay + comment logged
(image with caption "TSK-1054 done") → status = Done + image → Cloudinary
(image, no caption)                  → attached to most recent active task
Reply to wrong task ID               → REJECTED (security — only assignee can update)
```

### 3.5 Escalation engine

Runs via cron every 15 minutes. Fully configurable per deployment via `.env`:

```
ESCALATION_INTERVALS_HOURS="0,24,48,72"
MAX_ESCALATION_LEVEL="4"
```

| Interval index | Meaning |
|---|---|
| `[0]` = 0 | Escalate to L1 immediately when deadline is missed |
| `[1]` = 24 | Escalate to L2 after 24h at L1 |
| `[2]` = 48 | Escalate to L3 after 48h at L2 |
| `[3]` = 72 | Escalate to L4 after 72h at L3 |

**Notification routing:**

| Who escalates | Notified |
|---|---|
| Auto (cron) L1 | Assignee |
| Auto (cron) L2+ | Assignee + Manager |
| Manual by Employee | Their Manager |
| Manual by Manager | Admin + Assignee |
| Manual by Admin | Assignee + their Manager |

---

## 4. What Is Built (Current State — V1)

### ✅ Fully working

| Feature | Notes |
|---|---|
| JWT authentication + role-based access | Login, token refresh, role guards on all endpoints |
| Three-role dashboard system | Admin / Manager / Employee views, all role-specific |
| Task CRUD | Create, read, update, custom fields, readable IDs |
| WhatsApp task assignment notification | Fires on task creation, `alertDispatched` prevents duplicates |
| Inbound WhatsApp parsing | Text + image + video + document parsing |
| Cloudinary media storage | WhatsApp attachments → permanent CDN URLs |
| Auto-escalation engine | Configurable intervals, level cap, cron-based |
| Manual escalation | Role-aware, shows who gets notified before clicking |
| Approval workflow | Approve → Retract, one-time guard, live task state |
| Team management | Add / Edit / Delete members, hierarchy (reporting tree) |
| Org chart view | Indented hierarchy, task progress per person |
| Timeline / Gantt view | Monthly view, colour-coded priority bars, select by manager |
| WhatsApp Live Tracker | Real message thread per task, send free text or template |
| Bell notifications | 5s polling, colour-coded, clickable → opens task |
| Activity audit log | Every state change, comment, escalation, media attachment |
| Dark mode | Persists to localStorage |

### ⚠️ Partially built / needs polish

| Feature | Current state | What's missing |
|---|---|---|
| Analytics view | Dashboard KPI cards exist | Real DB aggregations (currently mock data) |
| WhatsApp templates | `task_assignment` + `task_escalation` designed | Need Meta approval (submit to Meta Business Manager) |
| Permanent Meta token | Uses 24h sandbox token | Need System User token (15 min to set up in Meta Business Manager) |
| Webhook public URL | Uses ngrok (restarts on reboot) | Deploy to Render (render.yaml is ready) |

---

## 5. What Needs to Be Built (V2 Roadmap)

These are the meaningful gaps between V1 and a complete enterprise product:

### 5.1 Security hardening (must-have before production)

| Item | Why | Effort |
|---|---|---|
| Rate limiting on API endpoints | Prevent brute force on `/api/auth/login` | Low — add `express-rate-limit` |
| HTTPS enforced everywhere | All traffic must be encrypted | Config only (Render handles this) |
| JWT refresh tokens | Current tokens are 7-day, no logout mechanism | Medium |
| Webhook signature verification | Verify Meta HMAC-SHA256 signature on every inbound webhook | Low — code stub exists |
| Input sanitisation | XSS / SQL injection hardening | Low — Prisma parameterises, add `zod` validation |
| Environment secrets in vault | Credentials should be in a secret manager, not `.env` | Medium |

### 5.2 Real-time instead of polling

| Item | Current | Target |
|---|---|---|
| Notifications | Poll every 5s (300 req/min for 50 users) | WebSocket / SSE push |
| Task list | Poll every 30s | WebSocket push on task update |
| WhatsApp thread | Static until page refresh | Live stream when webhook fires |

**Impact:** Replaces ~80% of DB load, supports 5-10× more concurrent users.

### 5.3 Multi-tenancy (for client delivery)

This is the most important architectural decision for delivering to multiple clients.

| Approach | Description | Recommended? |
|---|---|---|
| **Separate deployments** | Each client gets their own Render service + Neon DB | ✅ Yes for V1 clients — simple, isolated, secure |
| **Schema-per-tenant** | One deployment, separate Postgres schemas | Medium complexity, good isolation |
| **Row-level tenancy** | `tenantId` column on every table | Complex, risk of data leakage |

**Recommendation for now:** Separate deployments per client. Render + Neon free tier = ~$0/client for low volume. One `render.yaml` file, one env var file swap, 15-minute onboarding.

### 5.4 Analytics — real data

| Widget | Current | Target |
|---|---|---|
| Completion rate | Mock | `COUNT(status='Done') / COUNT(*)` grouped by week |
| On-time delivery | Mock | `deadline > updatedAt WHERE status='Done'` |
| Escalation trends | Mock | `COUNT(escalationLevel > 0)` grouped by day |
| Per-employee score | Calculated live | Cache in Redis or materialised view |

### 5.5 Additional features for enterprise clients

| Feature | Value |
|---|---|
| **Bulk task import (CSV)** | Onboard clients with existing task lists |
| **Recurring tasks** | Daily / weekly / monthly repeating tasks |
| **SLA breach reporting** | Email/PDF report of overdue tasks by week |
| **Audit log export** | Download full activity history as CSV |
| **Role-based field visibility** | Hide custom fields from certain roles |
| **Multi-language WhatsApp templates** | Hindi, Tamil, etc. for Indian clients |
| **Client-facing portal** | End customer can track their service request status |

---

## 6. Deployment Guide (Per Client)

### Prerequisites (one-time, global)

- Meta Business Account → WhatsApp Business API access
- Cloudinary account (free tier)
- Render account (free tier or $7/mo starter)
- Neon account (free tier)

### Per-client onboarding (~30 minutes)

```bash
# 1. Clone the repo
git clone https://github.com/SahilShrivastava-Dev/flowdesk.git client-name
cd client-name

# 2. Create Neon database
# → neon.tech → New project → copy DATABASE_URL

# 3. Fill in backend/.env (template below)
# → Neon DATABASE_URL
# → Meta Phone ID + Access Token (System User)
# → Cloudinary credentials
# → Set ESCALATION_INTERVALS_HOURS for their business type

# 4. Push DB schema + seed demo data
cd backend
npx prisma db push
npx prisma db seed   # optional — remove for production

# 5. Deploy backend to Render
# → render.com → New Web Service → connect GitHub repo
# → Root dir: backend
# → Build: npm install && npm run build
# → Start: npm start
# → Add all env vars in Render dashboard

# 6. Deploy frontend to Vercel
# → vercel.com → Import from GitHub
# → Set VITE_API_URL = https://your-render-url.onrender.com

# 7. Register webhook in Meta dashboard
# → WhatsApp → Configuration
# → Callback URL: https://your-render-url.onrender.com/api/webhook
# → Verify token: (from META_VERIFY_TOKEN in .env)
# → Subscribe: messages

# 8. Submit WhatsApp templates to Meta
# → task_assignment (Category: Utility)
# → task_escalation (Category: Utility)
# → Approval: 15 min to 2 hours

# 9. Set META_TEMPLATES_APPROVED="true" in Render env vars
# → Redeploy

# 10. Create Admin user via API or DB seed
# Default credentials: aarav@flowdesk.io / flowdesk123 (change immediately)
```

### Environment variable checklist

```env
# Database
DATABASE_URL=

# Auth
JWT_SECRET=                    # generate: openssl rand -hex 32
JWT_EXPIRES_IN=7d

# Meta WhatsApp
META_PHONE_ID=
META_ACCESS_TOKEN=             # Use System User token (doesn't expire)
META_VERIFY_TOKEN=             # any strong random string
META_TEMPLATES_APPROVED=true

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Escalation (customise per client)
ESCALATION_INTERVALS_HOURS=0,24,48,72
MAX_ESCALATION_LEVEL=4

# CORS
FRONTEND_URL=https://client-name.vercel.app
```

---

## 7. Security Model

| Concern | Current implementation |
|---|---|
| Authentication | JWT signed with HS256, 7-day expiry |
| Password storage | bcrypt with salt rounds = 10 |
| Role enforcement | Every API route checks `req.user.role` |
| Task access | Employees see only their tasks, Managers see their reports', Admins see all |
| User management | Only Admins can create/delete users |
| WhatsApp inbound | Tasks can only be updated by the assigned employee's phone number |
| Wrong task ID | Hard rejected — no fallback to other users' tasks |
| Media | Stored on Cloudinary with private API credentials, not in DB |
| DB credentials | Never logged, never sent to frontend, in `.env` only |

---

## 8. Scalability Assessment

| Users | Architecture needed | Cost estimate |
|---|---|---|
| 1–50 concurrent | Current (polling, single process) | Free tier |
| 50–200 concurrent | Add WebSocket, PgBouncer | ~$20/mo |
| 200–1000 concurrent | WebSocket + Redis + PM2 cluster | ~$50–100/mo |
| 1000+ | Redis queue, horizontal scaling, CDN | Custom infra |

The current architecture is right-sized for teams up to ~50 concurrent users — which covers most SMB clients comfortably.

---

## 9. What Makes This Different

| Competitor | Gap FlowDesk fills |
|---|---|
| Jira / Linear | Too complex for field workers. Requires laptop + training |
| WhatsApp Business (manual) | No structure, no automation, no dashboards |
| FieldPulse / ServiceM8 | Expensive ($50–200/mo), generic, no WhatsApp native flow |
| Excel + WhatsApp group | No audit trail, no escalation, no accountability |

FlowDesk is purpose-built for the segment where employees are mobile, on-ground, and WhatsApp-first — with management needing visibility and accountability.

---

## 10. Phase 3: AI-Powered Operations (Future Roadmap)

Integrating artificial intelligence can transform FlowDesk from a standard task-tracking CRUD system into a highly intuitive, automated, and "voice-native" operational brain. Since field workers interact using unstructured text, photos, and voice notes, AI plays a crucial role in bridging the gap between raw messaging and structured database states.

### 10.1 AI Features & Deployment Phases

```
Phase 3.1: Natural Language Core  ──►  Phase 3.2: Multimodal Core  ──►  Phase 3.3: Operations Automation
· Smart Inbound Chat Parsing           · Voice Note Transcription         · Visual Quality Assurance (Vision)
· Natural Language Task Creator        · Auto Client Reports              · Dynamic Escalation Advice
```

#### Phase 3.1: Natural Language Processing (NLP) Core
* **Smart Inbound WhatsApp Parsing & Intent Extraction:**
  * **Objective:** Parse conversational updates (e.g., *"Hey sir, completed 1054 and left keys under mat. Going home."*) into clean structured states instead of expecting strict keywords like `TSK-1054 done`.
  * **AI Task:** LLM extracts Task ID, maps the user's intent (`Done`, `Issue`, `Delay`), and formats a clean audit log summary.
* **Natural Language Task Creator (Manager-Side):**
  * **Objective:** Allow managers to type or speak a single sentence to instantly generate a task.
  * **AI Task:** Converts *"Aarav, please go fix the plumbing leak at Lobby 402 by tomorrow 5pm"* into a structured task creation JSON object, pre-filling the web form.

#### Phase 3.2: Multimodal Audio & Text Core
* **WhatsApp Voice Note Transcription & Intent Mapping:**
  * **Objective:** Allow field workers to send a 15-second WhatsApp voice note instead of typing on-screen.
  * **AI Task:** Native audio processing transcribes the worker's voice, translates regional slang/language to English (if needed), and extracts the task ID and status.
* **Professional Client Report Generator:**
  * **Objective:** Automatically translate informal worker comments into clean customer updates.
  * **AI Task:** Transforms worker slang (*"done with cab. left key under mat. client happy"*) into a polite, branded message (*"Dear Valued Customer, we are pleased to inform you that your cabinet repair is complete..."*).

#### Phase 3.3: Visual Quality Assurance (Vision QA)
* **Automated Image & Proof of Work Inspection:**
  * **Objective:** Eliminate manual manager QA reviews for every single task photo.
  * **AI Task:** Vision LLM reviews the uploaded photo proof and verifies:
    1. Is the job actually complete (e.g., is the mirror fully installed and mounted)?
    2. Is the site left clean (no trash, tools, or debris left behind)?
    3. Are there visible defects or damages?
  * **Automated Loop:** If the AI flags a messy site, it replies to the worker's WhatsApp: *"It looks like some tools are still on the counter. Please tidy up and upload a new photo to complete the task."*

---

### 10.2 Technical Requirements & APIs

To run this AI layer, we do **not** need massive custom infrastructure. The entire roadmap can be built using serverless AI APIs, keeping deployment costs and maintenance near zero.

#### 1. Recommended API & Models
* **Google Gemini API** (using the `@google/genai` or `@google/vertexai` SDK) is recommended due to its native multi-modality (can process text, audio, images, and video in a single call), large context window, sub-second speed, and extremely low pricing.
* **Model Selection:**
  * **Gemini 2.5 Flash / Gemini 2.0 Flash:** Best for general-purpose text parsing, voice-to-text, and image verification (multimodal). It is blazing fast and cost-effective.
  * **Gemini 2.5 Flash-Lite:** Ideal for low-latency, high-volume text parsing.

#### 2. Dependencies & Integration Points
* **Node.js SDK:** Install `@google/genai` on the Express backend.
* **Credentials:** Add a single `GEMINI_API_KEY` to your environment variables (or save it securely in your Secret Vault).
* **Audio Parsing Library (Optional):** WhatsApp voice notes are sent as `.ogg` files. The backend will require `fluent-ffmpeg` or standard API encoding to pass the audio data directly to Gemini's multimodal endpoint.

---

### 10.3 "How Much API?" — Volume & Cost Estimations

Because LLM API consumption is priced per **million tokens** (roughly 750,000 words), running an operations system like FlowDesk is extremely affordable.

#### API Call Frequency (Per Workflow)
* **Inbound WhatsApp Text:** 1 API call per message (Gemini Flash processes the message and returns structured JSON).
* **Inbound WhatsApp Voice Note:** 1 API call per voice file (Gemini Flash directly ingests the audio and returns JSON).
* **Inbound Task Photo Proof:** 1 API call per task completion photo.
* **Manager Task Creation:** 1 API call (triggered only when using the natural language prompt bar).
* **Client Report Drafting:** 1 API call per completion event.

#### Sample Volume & Monthly Cost Calculation
Let's calculate the API usage for a **typical medium-sized client deployment**:
* **Active Workers:** 50
* **Tasks per Worker per Day:** 4
* **Total Tasks per Day:** 200 tasks
* **Inbound Messages/Replies per Day:** 250 WhatsApp messages (text, photos, or voice notes)
* **API Calls per Day:** ~300 calls

##### Gemini 2.5 Flash Pricing Model:
* **Input Price:** $0.075 / million tokens (1k tokens $\approx$ 1 long chat thread + 1 task details)
* **Output Price:** $0.30 / million tokens (Output is small JSON, $\approx$ 200 tokens)
* **Average Cost per Call:** Less than **$0.0001** (fraction of a cent)

##### Estimated Cost Breakdown:
* **Daily Calls:** 300 calls $\approx$ 300,000 input tokens + 60,000 output tokens.
* **Daily Cost:** $(0.3 \times 0.075) + (0.06 \times 0.30) = $0.0225 + $0.018 \approx$ **$0.04 (4 cents) per day**.
* **Monthly Cost:** $0.04 \times 30 =$ **$1.20 per month**!

Even if workers upload high-resolution completion photos (which consume more tokens per image), the total monthly API bill for a client with 50 active field workers will be **less than $5.00 to $10.00 / month**, making AI integration exceptionally viable and highly profitable for SaaS margins.

---

## 11. Document Revision

| Version | Date | Changes |
|---|---|---|
| 0.1 | May 2026 | Initial architecture draft |
| 1.0 | May 2026 | V1 feature complete: auth, tasks, WhatsApp, escalation, timeline, tracker |
| 2.0 | May 2026 | Phase 3 Roadmap added: Detailed AI-powered capabilities, API requirements, and cost estimates |


