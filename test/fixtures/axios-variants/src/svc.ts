import axios from 'axios'
export const a = () => axios.get('https://x.dev/a')
export const b = () => axios.post('https://x.dev/b', {}, { timeout: 3000 })
export const c = () => axios.put('https://x.dev/c', {})
export const d = () => axios({ method: 'get', url: 'https://x.dev/d' })
