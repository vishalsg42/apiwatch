import axios from 'axios'
const cfg = { headers: {} }
export const f = () => axios.get('https://v.dev/a', { timeout: 5000, ...cfg })
