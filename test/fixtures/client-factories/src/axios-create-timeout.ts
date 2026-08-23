import { create } from 'axios'
const api = create({ baseURL: 'https://vendor.example.com', timeout: 5000 })
export const getUser = (id: string) => api.get(`/users/${id}`)
