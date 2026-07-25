import { Container, db, ProjectsRepository } from '@bg/core';
import { ProjectController } from './project/project.controller';

export const container = new Container();

container.registerFactory(ProjectsRepository, () => {
  return new ProjectsRepository(db);
});

container.registerFactory(ProjectController, (c) => {
  return new ProjectController(c.resolve(ProjectsRepository));
});
