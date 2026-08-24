import axios from 'axios'
const clients: Record<string, typeof axios> = { primary: axios }
declare const name: string

export const viaIndex = () => clients[name].get('https://v.dev/a')
export const viaName = () => axios.get('https://v.dev/b')
