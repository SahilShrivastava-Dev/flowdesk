# FlowDesk: Comprehensive Product & Technical Documentation

---

## 1. Executive Summary
**FlowDesk** is a unified, hierarchical task-operations platform equipped with first-class WhatsApp integration. It is designed to bridge the gap between back-office management and frontline/field workers. FlowDesk allows managers to assign, track, and analyze tasks via a comprehensive web dashboard while empowering employees to receive and update their assignments purely through WhatsApp, eliminating the need to install or learn a new application.

---

## 2. The Problem Statement
In many operational environments (such as field sales, logistics, maintenance, and distributed frontline teams), communication and task management break down because:
1. **App Fatigue:** Field workers are reluctant to download, learn, and consistently use complex task management applications.
2. **Scattered Context:** Work is often assigned verbally or scattered across fragmented WhatsApp groups, leading to lost context and untrackable progress.
3. **Lack of Visibility:** Leadership and middle management have no real-time dashboard to see the health of operations, completion rates, or bottlenecks without constantly calling or texting employees.
4. **Missed Deadlines:** When a field worker gets blocked or misses a deadline, management is often unaware until the client complains. There is no automated escalation mechanism.

---

## 3. Product Overview
FlowDesk solves these problems by merging a **powerful Web Dashboard** (for Admins and Managers) with an **Automated WhatsApp Bot** (for Employees). 

* **The Web App** acts as the single source of truth. Managers create tasks, set deadlines, and view analytics here.
* **The WhatsApp Bot** acts as the interface for the field worker. The system messages the worker on WhatsApp when a task is assigned. The worker replies to that message with simple keywords (`Done`, `Issue`, `Delay`), and the system automatically parses the reply and updates the dashboard in real-time.

---

## 4. Technology Stack

### 4.1 Current State: Interactive Prototype
Currently, the codebase is a high-fidelity, interactive frontend prototype used to demonstrate the UX and UI flow to stakeholders.
* **Frontend Framework:** React 18
* **Build Tool:** Vite 6
* **Styling:** Tailwind CSS 3 (with custom palettes and dark mode support)
* **Data Visualization:** Recharts (for analytics, pie charts, and bar charts)
* **Icons:** lucide-react
* **State Management:** React Context API (simulating a database and API calls)
* **Data Storage:** In-memory mock data (`mockData.js`)

### 4.2 Proposed State: Production Architecture
To make FlowDesk a fully functional SaaS application, the following backend architecture will be implemented:
* **Backend API:** Node.js, Express, and TypeScript.
* **Database:** PostgreSQL (Managed, to store users, tasks, phone numbers, and activity logs).
* **Authentication:** JWT (JSON Web Tokens) with bcrypt for password hashing.
* **WhatsApp Integration:** A Business Solution Provider (BSP) like Wati, Gupshup, or AiSensy. The BSP will sit between the Meta Cloud API and the Node.js backend to simplify message templates and handle webhook payloads.
* **Background Jobs:** `node-cron` to check for missed deadlines and trigger auto-escalations.
* **Hosting:** Vercel (Frontend CDN) and Render/Railway (Backend & Database).

---

## 5. Core Modules & Features

### 5.1 Role-Based Access Control (RBAC) & Hierarchy
The system relies on a strict 3-tier hierarchy:
* **Admin (e.g., Regional Head):** Can view all data across the entire organization, manage the user database, override escalations, and see high-level analytics.
* **Manager (e.g., City Lead):** Can only view and manage tasks for their direct reports. They approve/reject completed tasks and receive first-level escalations.
* **Employee (e.g., Field Technician):** Receives tasks. Can update the status of their own tasks but cannot see company-wide analytics or other employees' tasks.

### 5.2 The Web Dashboard Module
The central hub for management.
* **Task Table:** A filterable, sortable list of tasks with priority and status badges.
* **Analytics Cards:** Real-time data including completion percentages, overdue task counts, and workload distribution per employee.
* **Activity Timeline:** Clicking a task opens a modal showing the entire history (when it was created, when a WhatsApp message was sent, when the user replied, and manager approvals).
* **Custom Fields:** Tasks can have dynamic metadata (e.g., Client Name, PO Number, Budget) without needing database schema changes.

### 5.3 WhatsApp Bot Module (The Parser)
* **Outbound Alerts:** Uses pre-approved Meta message templates to notify users of assignments or rejections.
* **Inbound Parsing:** Uses deterministic Regex/Keyword matching to read employee replies. It looks for a `Task ID` (e.g., TSK-1042) and a trigger keyword (`Done`, `Issue`, `Delay`). Any additional text is logged as a comment.

### 5.4 Auto-Escalation Engine
A CRON job that runs continuously in the background. If a task's deadline passes and the status is not "Done", it increments the `escalationLevel` and sends a WhatsApp alert to the employee's direct manager. If ignored further, it escalates to the Admin.

### 5.5 User Management Module (To Be Built)
An Admin settings panel where new users are added. Crucially, this is where the employee's **Name, Role, Reporting Manager, and WhatsApp Phone Number (+Country Code)** are stored.

---

## 6. Comprehensive User Journeys (A to Z)

### Use Case 1: The Ideal Task Flow (Employee Success)
1. **Creation:** Manager *Priya* logs into the dashboard, clicks "+ New Task", writes "Repair AC at Site B", sets a deadline for 5:00 PM, and assigns it to Employee *Sneha*.
2. **Notification:** The backend triggers the BSP. Sneha's phone buzzes with a WhatsApp message from the official company number: *"New Task Assigned [TSK-1042]: Repair AC at Site B. Deadline: 5:00 PM."*
3. **Execution & Reply:** Sneha finishes the repair at 4:00 PM. She replies to the WhatsApp thread: *"TSK-1042 done. Replaced the compressor."*
4. **Parsing:** The webhook receives the message, parses "TSK-1042" and "done". The backend updates the database status to `Done (Unapproved)`.
5. **Approval:** Priya sees the task turn green on her dashboard. She clicks it, reads Sneha's comment about the compressor, and clicks **Approve**. The task is officially closed.

### Use Case 2: The Blocked Task (Issue Reporting)
1. **Creation:** Manager *Priya* assigns TSK-1043 to *Sneha* (Fix Router at Site C).
2. **The Block:** Sneha arrives, but the building is locked. She replies on WhatsApp: *"TSK-1043 issue: Security won't let me in without an ID badge."*
3. **Status Update:** The system marks the task as `Issue` (Red badge) and immediately sends an alert to Priya: *"Sneha reported an issue on TSK-1043."*
4. **Resolution:** Priya calls the client to clear security. Once cleared, Priya changes the task status back to `Pending` on the dashboard, which pings Sneha: *"Your manager has unblocked TSK-1043. Please proceed."*

### Use Case 3: The Missed Deadline (Auto-Escalation)
1. **Creation:** Task TSK-1044 is assigned to *Karan* with a deadline of Tuesday 12:00 PM.
2. **The Miss:** Tuesday 12:00 PM passes. Karan hasn't replied "done" on WhatsApp.
3. **Level 1 Escalation:** The CRON job detects the miss. At 12:15 PM, it sends a WhatsApp message to Karan's Manager: *"Alert: Karan has missed the deadline for TSK-1044."*
4. **Level 2 Escalation:** 24 hours later, the task is still not done. The system escalates it to the Regional Admin, ensuring accountability.

### Use Case 4: Manager Rejection
1. **Completion:** *Sneha* replies on WhatsApp: *"TSK-1045 done."*
2. **Review:** Manager *Priya* reviews the task on the dashboard but realizes Sneha forgot to attach the client signature photo.
3. **Rejection:** Priya clicks **Reject** and types: *"Please upload the signed receipt."*
4. **Feedback Loop:** The task reverts to `Pending`. Sneha receives a WhatsApp message: *"Your manager rejected TSK-1045. Reason: Please upload the signed receipt."* Sneha uploads the photo and replies "done" again to restart the loop.

---

## 7. Data Flow & Security
1. Web Dashboard (React) communicates via HTTPS/JSON to the FlowDesk API (Node.js).
2. FlowDesk API stores state in PostgreSQL.
3. To message an employee, FlowDesk API sends a REST payload to the BSP.
4. The BSP handles the Meta Graph API complexity and sends the WhatsApp message.
5. Employee replies are caught by the BSP, which POSTs the raw JSON to the FlowDesk Webhook endpoint.
6. Role permissions are strictly enforced on the server-side before any status changes occur.
