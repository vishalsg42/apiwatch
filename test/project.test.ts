import { describe, expect, it } from 'vitest'
import { createProjects } from '../src/static/project.js'
import { discoverWorkspace } from '../src/workspace/discover.js'
import { fx } from './helpers.js'

describe('createProjects', () => {
  it('creates one project per package dir', async () =>
    expect(createProjects(await discoverWorkspace(fx('monorepo')))).toHaveLength(2))
  it('adds plain JS files with allowJs', async () => {
    const [{ project }] = createProjects(await discoverWorkspace(fx('simple-express')))
    expect(project.getSourceFiles().some((f) => f.getFilePath().endsWith('payments.js'))).toBe(true)
  })
  it('does not resolve into node_modules', async () => {
    const [{ project }] = createProjects(await discoverWorkspace(fx('simple-express')))
    expect(project.getSourceFiles().some((f) => f.getFilePath().includes('node_modules'))).toBe(
      false,
    )
  })
  it('groups files into the correct project directory, each with the expected files in order', async () => {
    const projects = createProjects(await discoverWorkspace(fx('project-grouping')))
    const named = (dirSuffix: string) => {
      const found = projects.find(({ dir }) => dir.endsWith(dirSuffix))
      if (!found) throw new Error(`no project for ${dirSuffix}`)
      return found.project.getSourceFiles().map((f) => f.getFilePath().split('/').pop())
    }
    // ws.sourceFiles is globally sorted before grouping, so within each dir the files come
    // out in alphabetical order: one, three, two (not insertion order one, two, three).
    expect(named('packages/alpha')).toEqual(['one.ts', 'three.ts', 'two.ts'])
    expect(named('packages/beta')).toEqual(['x.ts', 'y.ts'])
  })
})
