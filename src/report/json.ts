import type { ReportModel } from '../model.js'

export function renderJson(m: ReportModel): string {
  return JSON.stringify(m, null, 2)
}
