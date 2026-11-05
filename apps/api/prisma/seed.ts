import { recordAudit } from '../src/lib/audit';
import { hashPassword } from '../src/lib/password';
import { prisma } from '../src/lib/prisma';

/**
 * Creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME.
 * Safe to re-run: it never overwrites an existing account.
 */
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME?.trim() || 'System Administrator';

  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in your shell before running the seed.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('ADMIN_EMAIL is not a valid email address.');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log(`An account for ${email} already exists. Nothing was changed.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({
      data: { email, passwordHash, fullName, role: 'ADMIN' },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId: admin.id,
      action: 'admin.seed',
      entityType: 'User',
      entityId: admin.id,
      after: { email, role: 'ADMIN' },
    });
  });
  console.log(`Administrator ${email} created.`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
