import { Contact, ContactType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Actor, canMessageContact, visibleContacts } from './permissionService';
import { normalisePhone } from './whatsappService';
import { Candidate } from './nameResolutionService';
import { TaskOpError } from './taskService';

// ─────────────────────────────────────────────────────────────────────────────
// External parties: customers, vendors, sellers, suppliers, buyers.
//
// Everything that reads or writes a contact goes through here, so the web API
// and the WhatsApp command executor cannot drift apart — the same rule that
// `taskService` exists to enforce for tasks.
//
// Two rules live here rather than at the call sites, because both are the kind
// that gets forgotten exactly once:
//
//   1. A phone number identifies ONE party. Inbound resolution matches on the
//      last ten digits, so a number shared by a User and a Contact would leave
//      the webhook with two possible senders and no way to choose. It is
//      refused at write time instead of guessed at read time.
//
//   2. Opt-out is permanent. A party who replies STOP is never messaged again,
//      whatever any later command says.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateContactInput {
  name: string;
  phone: string;
  type?: ContactType;
  companyName?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string;
  aliases?: string[];
  externalRef?: string | null;
  preferredLanguage?: string;
  /** Defaults to the actor — whoever adds a contact owns it unless told otherwise. */
  ownerId?: string;
}

export type UpdateContactInput = Partial<Omit<CreateContactInput, 'phone'>> & {
  phone?: string;
};

const contactSelect = {
  id: true, name: true, companyName: true, phone: true, type: true,
  email: true, address: true, notes: true, aliases: true, externalRef: true,
  preferredLanguage: true, ownerId: true,
  optInAt: true, optOutAt: true, archivedAt: true, createdAt: true,
} as const;

/**
 * Refuse a number that already belongs to somebody.
 *
 * Checks both directions: another contact, and any active employee. The
 * employee half is the one that matters — `resolveSenderByPhone` prefers a
 * `User`, so a colliding contact would be silently unreachable on inbound
 * rather than visibly broken.
 */
async function assertPhoneIsFree(phone: string, excludeContactId?: string): Promise<void> {
  const last10 = phone.replace(/\D/g, '').slice(-10);
  if (last10.length < 10) {
    throw new TaskOpError('invalid', 'That does not look like a valid phone number');
  }

  const clash = await prisma.contact.findFirst({
    where:  { phone: { contains: last10 }, ...(excludeContactId && { id: { not: excludeContactId } }) },
    select: { id: true, name: true },
  });
  if (clash) {
    throw new TaskOpError('invalid', `That number is already saved for ${clash.name}`);
  }

  const staff = await prisma.user.findFirst({
    where:  { phone: { contains: last10 }, deactivatedAt: null },
    select: { id: true, name: true },
  });
  if (staff) {
    throw new TaskOpError(
      'invalid',
      `That number belongs to ${staff.name}, who is on the team — a person cannot be both`,
    );
  }
}

export async function createContact(actor: Actor, input: CreateContactInput) {
  if (actor.role === 'Employee') {
    throw new TaskOpError('forbidden', 'Only an Admin or Manager can add a contact');
  }

  const name = input.name?.trim();
  if (!name) throw new TaskOpError('invalid', 'a contact needs a name');

  const phone = normalisePhone(input.phone ?? '');
  await assertPhoneIsFree(phone);

  // A Manager may only create contacts they own; letting them hand one to
  // somebody else would put it outside their own `visibleContacts` and make it
  // immediately unreachable to them.
  const ownerId = actor.role === 'Admin' ? (input.ownerId ?? actor.id) : actor.id;

  return prisma.contact.create({
    data: {
      name,
      phone,
      type:              input.type ?? ContactType.other,
      companyName:       input.companyName?.trim() || null,
      email:             input.email?.trim() || null,
      address:           input.address?.trim() || null,
      notes:             input.notes ?? '',
      aliases:           dedupeAliases(input.aliases),
      externalRef:       input.externalRef?.trim() || null,
      preferredLanguage: input.preferredLanguage ?? 'en',
      ownerId,
    },
    select: contactSelect,
  });
}

export async function updateContact(actor: Actor, id: string, input: UpdateContactInput) {
  if (!(await canMessageContact(actor, id))) {
    // Same set that governs messaging governs editing: a contact you cannot
    // see is not one you can rename.
    throw new TaskOpError('forbidden', 'That contact is not yours to edit');
  }

  const data: Prisma.ContactUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new TaskOpError('invalid', 'a contact needs a name');
    data.name = name;
  }
  if (input.phone !== undefined) {
    const phone = normalisePhone(input.phone);
    await assertPhoneIsFree(phone, id);
    data.phone = phone;
  }
  if (input.type !== undefined)              data.type = input.type;
  if (input.companyName !== undefined)       data.companyName = input.companyName?.trim() || null;
  if (input.email !== undefined)             data.email = input.email?.trim() || null;
  if (input.address !== undefined)           data.address = input.address?.trim() || null;
  if (input.notes !== undefined)             data.notes = input.notes;
  if (input.aliases !== undefined)           data.aliases = dedupeAliases(input.aliases);
  if (input.externalRef !== undefined)       data.externalRef = input.externalRef?.trim() || null;
  if (input.preferredLanguage !== undefined) data.preferredLanguage = input.preferredLanguage;
  if (input.ownerId !== undefined && actor.role === 'Admin') {
    data.owner = { connect: { id: input.ownerId } };
  }

  return prisma.contact.update({ where: { id }, data, select: contactSelect });
}

/**
 * Archive rather than delete.
 *
 * A contact who has been messaged owns rows in `Message`, and tasks may point
 * at them. Deleting is either impossible or destroys the record of what was
 * sent to whom — which, for money, is the part you least want to lose.
 */
export async function archiveContact(actor: Actor, id: string) {
  if (actor.role !== 'Admin') {
    throw new TaskOpError('forbidden', 'Only an Admin can archive a contact');
  }
  const existing = await prisma.contact.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new TaskOpError('not_found', 'No such contact');

  return prisma.contact.update({
    where:  { id },
    data:   { archivedAt: new Date() },
    select: contactSelect,
  });
}

export async function listContacts(actor: Actor) {
  return visibleContacts(actor);
}

export async function getContact(actor: Actor, id: string) {
  if (!(await canMessageContact(actor, id))) {
    throw new TaskOpError('forbidden', 'That contact is not yours to view');
  }
  return prisma.contact.findUnique({ where: { id }, select: contactSelect });
}

/**
 * Record that a party asked to stop being messaged.
 *
 * Deliberately takes no `Actor`: this is driven by the inbound webhook when
 * somebody replies STOP, and honouring it is not a permissioned decision.
 * Idempotent, so a second STOP does not move the timestamp and lose when they
 * first asked.
 */
export async function recordOptOut(contactId: string): Promise<void> {
  await prisma.contact.updateMany({
    where: { id: contactId, optOutAt: null },
    data:  { optOutAt: new Date() },
  });
}

/** The inverse — used when a party explicitly asks to resume. */
export async function recordOptIn(contactId: string): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data:  { optInAt: new Date(), optOutAt: null },
  });
}

/**
 * The candidate list for name resolution, with aliases expanded.
 *
 * Each alias becomes its own candidate pointing at the same contact id, which
 * is what lets "Ramesh Traders", "रमेश ट्रेडर्स" and "RT Textiles" all resolve to
 * one row without the matcher needing to know aliases exist. The company name
 * is included for the same reason — people name a business as often as a person.
 *
 * Duplicated ids in the list are expected and harmless: `resolveName` scores
 * every candidate and the best one wins, so the only effect of an alias is
 * another chance to match.
 */
export async function contactCandidates(actor: Actor): Promise<Array<Candidate & { contactId: string }>> {
  const contacts = await visibleContacts(actor);

  const out: Array<Candidate & { contactId: string }> = [];
  for (const c of contacts) {
    const names = new Set<string>([c.name]);
    if (c.companyName) names.add(c.companyName);
    for (const alias of c.aliases) if (alias.trim()) names.add(alias.trim());

    for (const name of names) {
      out.push({ id: c.id, name, contactId: c.id });
    }
  }
  return out;
}

/** Trim, drop empties, and de-duplicate case-insensitively. */
function dedupeAliases(aliases: string[] | undefined): string[] {
  if (!aliases?.length) return [];
  const seen = new Map<string, string>();
  for (const raw of aliases) {
    const alias = raw?.trim();
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (!seen.has(key)) seen.set(key, alias);
  }
  return [...seen.values()];
}

export type ContactRow = Awaited<ReturnType<typeof getContact>>;
export type { Contact };
