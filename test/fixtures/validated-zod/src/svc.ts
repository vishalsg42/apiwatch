import axios from 'axios'
import { z } from 'zod'

const S = z.object({ id: z.string() })

export const f = async () => S.parse((await axios.get('https://x.dev/a')).data)
