import axios from 'axios'
import { validate } from 'class-validator'

export const f = async () => {
  const r = await axios.get('https://x.dev/a')
  return validate(r.data)
}
