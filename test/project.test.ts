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
})
