import axios from 'axios'
export const f = async (url: string) => {
  let hasMore = true, page = 1
  const out: unknown[] = []
  while (hasMore) {
    const res = await axios.get(url, { params: { page } })
    out.push(...res.data.items)
    hasMore = res.data.hasNext
    page++
  }
  return out
}
