import { create } from 'axios'
const api = create({ baseURL: 'https://vendor.example.com' })
export const getUser = (id: string) => api.get(`/users/${id}`)
export const putUser = (id: string) => api.put(`/users/${id}`, {})
