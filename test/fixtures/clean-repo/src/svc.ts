import axios from 'axios'
import axiosRetry from 'axios-retry'
import { z } from 'zod'

const api = axios.create({ timeout: 5000 })
axiosRetry(api, { retries: 3 })

const S = z.object({ id: z.string() })

export const f = async () => S.parse((await api.get(process.env.BASE + '/x')).data)
