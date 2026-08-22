import axios from 'axios'
export class S {
  api: any
  constructor() {
    this.api = axios.create({ timeout: 5000 })
  }
  f() {
    return this.api.get('/x')
  }
}
