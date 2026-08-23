import axios from 'axios'
const cfg = { timeout: 5000 }
export const f = () => axios.get('https://v.dev/a', { ...cfg, timeout: 0 })
