import axios from 'axios'

export async function fetchAll(pageNo = 1) {
  let hasMore = true
  const items: unknown[] = []
  while (hasMore) {
    try {
      const response = await axios.get('https://x.dev/a', { params: { pageNo } })
      items.push(...response.data.items)
      hasMore = response.data.hasMore
      pageNo += 1
    } catch {
      hasMore = false
    }
  }
  return items
}
