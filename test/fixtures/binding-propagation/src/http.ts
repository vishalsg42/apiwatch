import axios from 'axios'
export const shared = axios.create({ timeout: 2000 })
