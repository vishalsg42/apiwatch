import axios from 'axios'
export const f = () => axios.post('https://x.dev/jobs', { name: 'x', timeout: 60000 })
