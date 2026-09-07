/**
 * The two rules Prisma's schema language cannot express.
 *
 *   npm run db:constraints
 *
 * This project has no migrations directory — `render.yaml` runs
 * `prisma db push` on every deploy — so anything Prisma cannot describe in
 * `schema.prisma` has nowhere to live except here, and would otherwise have to
 * be remembered and run by hand on every database. It runs on every deploy
 * alongside the backfills, for the same reason they do.
 *
 * SAFE TO RE-RUN. Both statements are guarded, so a second run does nothing.
 *
 * 1. A Message belongs to exactly ONE of a user or a contact.
 *
 *    `Message.userId` was non-null and pointed at `User`; a thread with an
 *    external party has no owning employee, so it became nullable and gained
 *    `contactId`. Nullable-plus-nullable is not the same statement as "one or
 *    the other": without this a message could be written with neither owner and
 *    belong to no conversation at all, or with both and belong to two.
 *
 * 2. A phone number identifies one party.
 *
 *    Inbound resolution matches on the last ten digits. If the same number
 *    belonged to both a User and a Contact, the webhook would have two
 *    candidate senders and would have to guess which one was speaking — so the
 *    collision is prevented at write time rather than resolved at read time.
 *    Partial, because `User.phone` is nullable and several users have none.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // ── 1. Exactly one owner per message ─────────────────────────────────────
  //
  // Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so existence is checked
  // first. Re-running would otherwise fail the whole deploy on the second
  // deploy, which is a worse outcome than the constraint being missing.
  const existing = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM pg_constraint WHERE conname = 'message_one_owner'
  `;

  if (Number(existing[0]?.count ?? 0) === 0) {
    // Any row that already violates this would abort the ALTER and take the
    // deploy with it, so it is reported rather than discovered in a stack trace.
    const bad = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "Message"
      WHERE ("userId" IS NULL) = ("contactId" IS NULL)
    `;
    const badCount = Number(bad[0]?.count ?? 0);

    if (badCount > 0) {
      throw new Error(
        `Cannot add message_one_owner: ${badCount} message(s) have either both `
        + `an owner and a contact, or neither. Fix those rows first — they `
        + `belong to no conversation, or to two.`,
      );
    }

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Message"
        ADD CONSTRAINT message_one_owner
        CHECK ((("userId" IS NULL)::int + ("contactId" IS NULL)::int) = 1)
    `);
    console.log('[constraints] added message_one_owner');
  } else {
    console.log('[constraints] message_one_owner already present');
  }

  // ── 2. One party per phone number ────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_phone_unique
      ON "User" (phone)
      WHERE phone IS NOT NULL AND "deactivatedAt" IS NULL
  `);
  console.log('[constraints] user_phone_unique in place');

  // Reported rather than enforced: an existing collision predates the rule and
  // cannot be resolved automatically — we do not know which party the number
  // really belongs to, and guessing would silently misroute their messages.
  const collisions = await prisma.$queryRaw<Array<{ name: string; contact: string }>>`
    SELECT u.name AS name, c.name AS contact
      FROM "Contact" c
      JOIN "User" u ON RIGHT(u.phone, 10) = RIGHT(c.phone, 10)
     WHERE u."deactivatedAt" IS NULL
  `;

  if (collisions.length > 0) {
    console.warn(
      `[constraints] ⚠️  ${collisions.length} phone number(s) belong to both a `
      + `colleague and a contact. Inbound messages from these will be treated as `
      + `coming from the EMPLOYEE:\n`
      + collisions.map((c) => `    ${c.name} (staff) ↔ ${c.contact} (contact)`).join('\n'),
    );
  }
}

main()
  .catch((err) => {
    console.error('[constraints] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
