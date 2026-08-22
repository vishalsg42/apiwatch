import axios from 'axios'
export const f = () => axios({ method: 'get', url: 'https://x.dev/d', timeout: 3000 })
