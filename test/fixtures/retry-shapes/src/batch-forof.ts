import axios from 'axios'
export const f = async (ids: string[]) => {
  for (const id of ids) {
    try { await axios.get(`https://api.vendor.dev/${id}`) } catch { continue }
  }
}
