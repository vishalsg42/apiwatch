import axios from 'axios'
export const f = (body?: unknown) =>
  axios({ method: 'post', url: 'https://v.dev/a', ...(body && { data: body }) })
