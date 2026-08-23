import axios from 'axios'
export const f = async (url: string) => {
  for (let i = 0; i < 3; i++) {
    try { return (await axios.get(url)).data } catch { continue }
  }
}
