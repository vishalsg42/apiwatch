import axios from 'axios'

export const f = async () => (await axios.get('https://x.dev/a')).data
