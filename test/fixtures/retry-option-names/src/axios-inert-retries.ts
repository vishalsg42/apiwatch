import axios from 'axios'
export const f = () => axios.get('https://v.dev/a', { retries: 3 })
