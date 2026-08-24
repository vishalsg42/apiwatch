import axios from 'axios'
declare const base: Record<string, unknown>
export const f = () => axios.get('https://v.dev/a', { ...base, headers: {} })
