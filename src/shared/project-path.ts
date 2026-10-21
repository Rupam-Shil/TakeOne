/** Project packages are folders named `<name>.takeone`. */
export const PROJECT_EXT = '.takeone'
/** Projects made before the rename to Take One. They open, list and recover like new ones. */
export const LEGACY_PROJECT_EXTS = ['.studioclone']

const trimSlash = (p: string) => p.replace(/\/+$/, '')

export const isProjectPath = (p: string) => [PROJECT_EXT, ...LEGACY_PROJECT_EXTS].some((ext) => trimSlash(p).endsWith(ext))

/** Project name from its package path, whichever extension it has. */
export function projectName(p: string) {
  const base = trimSlash(p).split('/').pop() ?? ''
  for (const ext of [PROJECT_EXT, ...LEGACY_PROJECT_EXTS]) if (base.endsWith(ext)) return base.slice(0, -ext.length)
  return base
}
