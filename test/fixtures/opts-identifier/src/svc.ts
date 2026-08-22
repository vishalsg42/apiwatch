import axios from 'axios'

const opts = { timeout: 5000 }

export const f = (url: string) => axios.get(url, opts)
