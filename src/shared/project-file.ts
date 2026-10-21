import type { ProjectConfig } from './project'

/** <name>.studioclone/project.json */
export interface ProjectFile {
  version: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** Relative directories holding raw recordings (helper output). The first one is the primary clip. */
  recordings: string[]
  /** Null until the editor first opens the project and applies the default preset and auto-zooms. */
  config: ProjectConfig | null
}

export interface ProjectSummary {
  path: string
  id: string
  name: string
  createdAt: string
  updatedAt: string
  duration: number
  thumbnail: string | null
}
