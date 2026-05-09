import { users, policies } from './schema';
import { db } from './db';

await db.insert(users).values({
  email: 'begenchgeldyev@gmail.com',
  role: 'owner',
  attributes: {},
});

await db.insert(policies).values([
  {
    name: 'owner-full-access',
    effect: 'allow',
    subjectCondition: { role: 'owner' },
    action: '*',
    resource: '*',
  },
]);

console.log('Seeded successfully');
process.exit(0);
