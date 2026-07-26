import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { policies, users } from '../db/schema';

const db = drizzle(process.env.DATABASE_URL!);

export async function getSubjectAttributes(email: string | null) {
  if (!email) return { role: 'viewer' };

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) return { role: 'viewer' };

  return { role: user.role, ...(user.attributes as Record<string, unknown>) };
}

export async function getPolicies() {
  return db.select().from(policies);
}
