import axios from 'axios'
const api = axios.create({ timeout: 0 })
export const f = () => api.get('https://api.vendor.dev/a')
