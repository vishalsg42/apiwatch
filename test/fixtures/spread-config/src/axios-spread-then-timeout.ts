import axios from 'axios'
const cfg = { headers: {} }
export const f = () => axios.get('https://v.dev/a', { ...cfg, timeout: 5000 })
