import axios from 'axios'
export const f = () =>
  axios.post('https://x.dev/jobs', { timeout: 999 }, { timeout: 3000 })
