# ActiveTrack Backend Dummy Connection Suite ⚡❤️

This folder contains the dummy client implementation files for connecting to **Neon PostgreSQL** and **Redis** from a Node.js runtime environment. These connections represent the core infrastructural components of the ActiveTrack background architecture (the main SQL datastore and the Redis-backed BullMQ job queue).

## 📁 Directory Structure

```text
dummy/
├── index.js          # The execution runner (loads environment variables and runs both tests)
├── neonPostgres.js   # Neon PostgreSQL driver setup (standard 'pg' pool and edge options)
├── redisClient.js    # Redis client setup (using 'ioredis' with event handling and TTL operations)
└── README.md         # This documentation file
```

---

## 🛠️ Getting Started

### 1. Install Dependencies
Before running the tests, install the standard, highly robust production clients for PostgreSQL and Redis:

```bash
npm install pg ioredis
```

*Note: The runner script has a built-in lightweight `.env` parser, so you don't even need to install `dotenv` to load environment variables from the root folder!*

### 2. Configure Environment Variables
Create or update your `.env` file in the **root** of the workspace directory (`Caratsense/Task-Manager/`):

```env
# Neon PostgreSQL Connection String (must include ?sslmode=require)
DATABASE_URL="postgresql://<username>:<password>@<neon-hostname>/neondb?sslmode=require"

# Redis Server Connection String (can be local or cloud instance)
REDIS_URL="redis://default:<password>@<redis-hostname>:<port>"
```

---

## ⚡ Neon PostgreSQL Connection (`neonPostgres.js`)

**Why standard connection pooling?**
Neon is highly compatible with PostgreSQL clients. The standard `pg` pool allows your Node API server to manage multiple persistent connections efficiently, eliminating the CPU overhead of opening and closing a new socket handshake for every incoming request.

**Key features in this implementation:**
* **Pool Management:** Establishes connection pool configurations.
* **Mandatory SSL Encryption:** Specifically passes `{ ssl: { rejectUnauthorized: false } }` which is a requirement for Neon connection handshakes.
* **Graceful Termination:** Shuts down client pools using `pool.end()` so that Node processes do not hang indefinitely after finishing work.
* **Edge-Native Advice:** Provides an abstract configuration path to leverage `@neondatabase/serverless` for Vercel Edge or Cloudflare Workers.

---

## ❤️ Redis client (`redisClient.js`)

**Why `ioredis` instead of others?**
`ioredis` is the most robust, battle-tested, feature-rich Redis client in the Node.js ecosystem. It is the core engine beneath BullMQ (ActiveTrack's worker queue system).

**Key features in this implementation:**
* **Resilient Event Listeners:** Tracks lifecycle events like `connect`, `ready`, `error`, and `close`. This prevents silent app failures by logging problems in real time.
* **Fail-Fast Safeguards:** Configured with a `connectTimeout` of 5 seconds and a capped retry count so that your application doesn't freeze or consume CPU if Redis goes down.
* **Atomic Redis Store-Retrieve Operations:** Demonstrates storing a parsed JSON payload with a `TTL` (Time To Live) expiration value using the `'EX'` argument, followed by standard retrieval and clean deletion.
* **Clean Session Shutdown:** Cleanly disconnects using standard `redis.quit()` commands.

---

## 🚀 Running the Connection Suite

You can execute the connection test runner from the root directory using standard node:

```bash
node dummy/index.js
```

### Expected Output Structure (Success cases)
```text
======================================================
🚀 ACTIVE TRACK: DUMMY CONNECTION TESTER STARTING
======================================================
📡 Neon PostgreSQL Status: ✅ Configured (Masked Link)
📡 Redis Server Status:     ✅ Configured (Masked Link)

=========================================================
⚡ Neon PostgreSQL: Testing standard connection pool...
=========================================================
🔄 Connecting to Neon Database...
🟢 Client successfully checked out from pool.
🛰️  Executing active query: SELECT NOW();
🎉 Query executed successfully in 124ms!
📊 Database Response:
   - Server Time:      2026-05-20T14:50:00.000Z
   - PostgreSQL Ver:   PostgreSQL 16.2 on x86_64-pc-linux-gnu
🟢 Client released back to pool.
🔌 Pool closed cleanly.

=========================================================
❤️  Redis: Testing client connection and operations...
=========================================================
🔄 Initializing Redis client...
🟢 Redis: Client started connecting to server...
✅ Redis: Connection is fully established and ready for commands.
💾 Command: SET "activetrack:dummy_key" with 60s expiration...
🟢 Key stored successfully.
🔍 Command: GET "activetrack:dummy_key"...
🎉 Data successfully retrieved:
{
  "status": "success",
  "timestamp": "2026-05-20T14:50:00.124Z",
  "developerNote": "ActiveTrack queue pipeline check",
  "scope": "Dummy Test Code"
}
🧹 Command: DEL "activetrack:dummy_key"...
🟢 Cleanup complete.
🔌 Disconnecting from Redis...
🔌 Redis: Connection closed.

======================================================
📊 DUMMY PIPELINE RUN SUMMARY
======================================================
- Neon PostgreSQL Client Pool Connection: 🟢 SUCCESS
- Redis Server Key-Value & Expiry Ops:     🟢 SUCCESS
======================================================
```
