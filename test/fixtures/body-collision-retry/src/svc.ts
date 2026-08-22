import axios from 'axios'
export const f = () => axios.post('https://x.dev/orders/123/pay', { orderId: 123, retry: true })
