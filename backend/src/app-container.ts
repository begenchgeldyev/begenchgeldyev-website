import { Container } from "./DIContainer"
import { db } from "./db"
import { ProjectController } from "./src/project/project.controller"
import { ProjectsRepository } from "./src/project/project.repository"

export const container = new Container()

container.registerFactory(ProjectsRepository, () => {
	return new ProjectsRepository(db)
})
container.registerFactory(ProjectController, (c) => {
	return new ProjectController(c.resolve(ProjectsRepository))
})
