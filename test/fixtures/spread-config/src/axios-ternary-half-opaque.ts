import axios from 'axios'
declare const other: Record<string, unknown>
export const f = (slow?: boolean) =>
  axios({ method: 'post', url: 'https://v.dev/a', ...(slow ? { timeout: 5000 } : other) })
