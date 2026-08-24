import axios from 'axios'
declare const cfg: Record<string, unknown>
export const f = () => axios(cfg)
