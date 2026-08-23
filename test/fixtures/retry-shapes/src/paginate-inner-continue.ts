import axios from 'axios'
export const f = async (url: string) => {
  let hasMoreData = true
  let pageNo = 1
  while (hasMoreData) {
    try {
      const res = await axios.get(url, { params: { pageNo, pageSize: 100 } })
      for (const row of res.data.items as { id?: string }[]) {
        if (!row.id) {
          continue
        }
      }
      hasMoreData = res.data.hasNext
      pageNo++
    } catch {
      break
    }
  }
}
