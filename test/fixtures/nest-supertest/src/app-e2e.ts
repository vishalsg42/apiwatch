import request from 'supertest'
export const f = (app: any) => request(app).get('/health')
