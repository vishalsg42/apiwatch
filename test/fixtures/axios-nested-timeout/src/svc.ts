import axios from 'axios'
import https from 'https'
const api = axios.create({ httpsAgent: new https.Agent({ timeout: 5000 }) })
export const f = () => api.get('/x')
