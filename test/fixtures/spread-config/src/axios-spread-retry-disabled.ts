import axios from 'axios'
const cfg = { retries: 3 }
export const f = () => axios.get('https://v.dev/a', { ...cfg, retry: 0 })
