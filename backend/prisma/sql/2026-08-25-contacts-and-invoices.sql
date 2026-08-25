-- Contacts, invoices, and a Message that can belong to either side.
--
-- Everything Prisma can express lives in schema.prisma and arrives via
-- `prisma db push`. This file carries the two things it cannot.
--
-- Run AFTER db push, once, in a transaction.

BEGIN;

-- ── 1. A message has exactly one owner ────────────────────────────────────────
--
-- `Message.userId` was non-null and pointed at `User`; a thread with an
-- external party has no owning employee, so it became nullable and gained
-- `contactId`. Nullable-plus-nullable is not the same statement as "one or the
-- other" — without this, a message could be written with neither owner and
-- would then belong to no conversation at all, or with both and belong to two.
--
-- Prisma has no syntax for a check constraint, which is why this is here rather
-- than in the schema. Every row that existed before this migration has `userId`
-- set and `contactId` null, so the constraint validates on the way in.
ALTER TABLE "Message"
  ADD CONSTRAINT message_one_owner
  CHECK ((("userId" IS NULL)::int + ("contactId" IS NULL)::int) = 1);

-- ── 2. A phone number identifies one party ────────────────────────────────────
--
-- Inbound resolution matches on the last ten digits. If the same number
-- belonged to both a User and a Contact, the webhook would have two candidate
-- senders and would have to guess which one was speaking — so the collision is
-- prevented at write time rather than resolved at read time.
--
-- A partial unique index rather than a plain one: `User.phone` is nullable, and
-- several users legitimately have no number.
CREATE UNIQUE INDEX IF NOT EXISTS user_phone_unique
  ON "User" (phone)
  WHERE phone IS NOT NULL AND "deactivatedAt" IS NULL;

COMMIT;

-- Verification, after the fact:
--
--   SELECT COUNT(*) FROM "Message" WHERE ("userId" IS NULL) = ("contactId" IS NULL);
--     → must be 0
--
--   SELECT c.phone FROM "Contact" c
--     JOIN "User" u ON RIGHT(u.phone, 10) = RIGHT(c.phone, 10)
--    WHERE u."deactivatedAt" IS NULL;
--     → must be empty
