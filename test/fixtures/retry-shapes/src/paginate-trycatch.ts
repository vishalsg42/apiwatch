import axios from 'axios'
export const f = async (url: string) => {
  let hasMore = true, page = 1
  while (hasMore) {
    try {
      const res = await axios.get(url, { params: { page } })
      hasMore = res.data.hasNext
      page++
    } catch { break }
  }
}
