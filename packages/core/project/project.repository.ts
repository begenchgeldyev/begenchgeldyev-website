import { desc, eq } from 'drizzle-orm';
import { Injectable } from '../DIContainer';
import { type Db, projects } from '../db';

@Injectable()
export class ProjectsRepository {
  constructor(private readonly db: Db) {}

  list() {
    return this.db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async findById(id: number) {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return project ?? null;
  }

  updateById(
    id: number,
    input: { name: string; description: string | null; content: string | null; image: string | null; isHidden: boolean },
  ) {
    return this.db
      .update(projects)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();
  }

  create(input: { name: string; description: string | null; content: string | null; image: string | null; isHidden: boolean }) {
    return this.db.insert(projects).values(input).returning();
  }
}
