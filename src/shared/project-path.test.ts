import { describe, expect, it } from 'vitest'
import { isProjectPath, projectName } from './project-path'

describe('project paths', () => {
  it('recognises new and pre-rename project packages', () => {
    expect(isProjectPath('/Users/me/Movies/Take One/Demo.takeone')).toBe(true)
    expect(isProjectPath('/Users/me/Movies/Studio Clone/Demo.studioclone/')).toBe(true)
    expect(isProjectPath('/Users/me/Movies/Demo.mp4')).toBe(false)
  })

  it('names a project after its folder without the extension', () => {
    expect(projectName('/a/Product tour.takeone')).toBe('Product tour')
    expect(projectName('/a/Recording 2026-10-21 at 13.15.09.studioclone/')).toBe('Recording 2026-10-21 at 13.15.09')
    expect(projectName('/a/weird.name.takeone')).toBe('weird.name')
  })
})
