import axios from 'axios'
const timeout = 5000
export const f = () => axios.get('https://x.dev/a', { timeout })
