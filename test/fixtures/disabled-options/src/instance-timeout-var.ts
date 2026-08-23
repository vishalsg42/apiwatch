import axios from 'axios'
const ms = Number(process.env.T)
const api = axios.create({ timeout: ms })
export const f = () => api.get('https://api.vendor.dev/c')
