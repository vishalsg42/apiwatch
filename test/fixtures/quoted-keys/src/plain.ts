import axios from 'axios'
export const f = () => axios.get('https://v.dev/a', { timeout: 5000 })
