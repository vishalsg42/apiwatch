import axios from 'axios'
const timeout = 5000
const api = axios.create({ timeout })
export const f = () => api.get('/x')
