import axios from 'axios'
import { handle } from './other.js'

export const f = async () => handle(await axios.get('https://x.dev/a'))
