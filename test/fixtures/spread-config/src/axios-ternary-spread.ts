import axios from 'axios'
export const f = (slow?: boolean) =>
  axios({ method: 'post', url: 'https://v.dev/a', ...(slow ? { timeout: 5000 } : { timeout: 5000 }) })
