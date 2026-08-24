import axios from 'axios'
// `retry` is NOT an AxiosRequestConfig key. axios ignores it, so this call has no retry at all.
export const f = () => axios.get('https://v.dev/a', { retry: 3 })
