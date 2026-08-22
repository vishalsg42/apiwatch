import axios from 'axios'
const api = axios.create({ timeout: 5000 })
export const f = () => api.get('/x')
