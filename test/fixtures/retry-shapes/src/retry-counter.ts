import axios from 'axios'
export const f = async (url: string, max: number) => {
  let attempt = 0
  while (attempt < max) {
    try {
      const res = await axios.get(url, { validateStatus: () => true })
      if (res.status >= 500 && attempt < max - 1) { attempt++; continue }
      return res.data
    } catch { attempt++ }
  }
}
