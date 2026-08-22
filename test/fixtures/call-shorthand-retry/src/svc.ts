import axios from 'axios'
const retry = true
export const f = () => axios.get('https://x.dev/a', { retry })
