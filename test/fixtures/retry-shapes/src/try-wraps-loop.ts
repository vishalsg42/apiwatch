import axios from 'axios'
export const f = async (urls: string[]) => {
  try {
    let i = 0
    while (i < urls.length) { await axios.get(urls[i]); i++; continue }
  } catch { /* one attempt at a loop, not a loop of attempts */ }
}
