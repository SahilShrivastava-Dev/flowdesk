import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

/**
 * Generate the next human-readable user ID.
 * Scans all existing IDs matching U<digits>, takes the max, increments by 1.
 * Falls back to U108 if none are found (seed data tops out at U107).
 * Zero-padded to 3 digits: U108, U109 … U999.
 */
async function generateUserId(): Promise<string> {
  const rows = await prisma.user.findMany({ select: { id: true } });
  const nums = rows
    .map((r) => r.id.match(/^U(\d+)$/)?.[1])
    .filter((n): n is string => n !== undefined)
    .map((n) => parseInt(n, 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 108;
  return `U${next.toString().padStart(3, '0')}`;
}

const safeSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  reportingToId: true,
  phone: true,
  avatar: true,
  color: true,
  createdAt: true,
};

export async function listUsers(req: Request, res: Response): Promise<void> {
  const { role, userId } = req.user!;

  if (role === 'Admin') {
    const users = await prisma.user.findMany({ select: safeSelect, orderBy: { name: 'asc' } });
    res.json(users);
    return;
  }

  if (role === 'Manager') {
    const users = await prisma.user.findMany({
      where: { OR: [{ id: userId }, { reportingToId: userId }] },
      select: safeSelect,
      orderBy: { name: 'asc' },
    });
    res.json(users);
    return;
  }

  // Employee — self only
  const user = await prisma.user.findUnique({ where: { id: userId }, select: safeSelect });
  res.json(user ? [user] : []);
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const { name, email, password, role, reportingToId, phone, avatar, color } = req.body as {
    name: string;
    email: string;
    password: string;
    role?: string;
    reportingToId?: string;
    phone?: string;
    avatar?: string;
    color?: string;
  };

  if (!name || !email || !password) {
    res.status(400).json({ error: 'name, email, and password required' });
    return;
  }

  const [passwordHash, id] = await Promise.all([
    bcrypt.hash(password, 10),
    generateUserId(),
  ]);
  try {
    const user = await prisma.user.create({
      data: {
        id,
        name,
        email,
        passwordHash,
        role: (role as 'Admin' | 'Manager' | 'Employee') ?? 'Employee',
        reportingToId: reportingToId ?? null,
        phone: phone ?? null,
        avatar: avatar ?? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
        color: color ?? 'from-slate-400 to-slate-600',
      },
      select: safeSelect,
    });
    res.status(201).json(user);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') {
      res.status(409).json({ error: 'Email already in use' });
    } else {
      throw err;
    }
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { role: callerRole, userId: callerId } = req.user!;

  const allowedFields: Record<string, string[]> = {
    Admin: ['name', 'email', 'role', 'reportingToId', 'phone', 'avatar', 'color'],
    Manager: ['name', 'phone', 'avatar', 'color'],
    Employee: ['name', 'phone', 'avatar', 'color'],
  };

  if (callerRole !== 'Admin' && id !== callerId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const permitted = allowedFields[callerRole] ?? [];
  const patch: Record<string, unknown> = {};
  for (const key of permitted) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }

  if (req.body.password && (callerRole === 'Admin' || id === callerId)) {
    patch.passwordHash = await bcrypt.hash(req.body.password as string, 10);
  }

  const user = await prisma.user.update({ where: { id }, data: patch, select: safeSelect });
  res.json(user);
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
}
