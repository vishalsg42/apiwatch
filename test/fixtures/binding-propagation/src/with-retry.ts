import axios from 'axios'
import axiosRetry from 'axios-retry'
const api = axios.create({ timeout: 1000 })
axiosRetry(api, { retries: 3 })
export const f = () => api.get('https://x.dev/b')
