import { desc } from 'drizzle-orm';
import { Injectable } from '@/DIContainer';
import { projects, type Db } from '@/db';

@Injectable()
export class ProjectsRepository {
  constructor(private readonly db: Db) {}

  list() {
    return this.db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  create(input: { name: string; description: string | null; content: string | null; image: string | null; isHidden: boolean }) {
    return this.db.insert(projects).values(input).returning();
  }
}
