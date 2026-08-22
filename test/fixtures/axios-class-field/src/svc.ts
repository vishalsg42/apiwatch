import axios from 'axios'
export class S {
  private readonly api = axios.create({ timeout: 5000 })
  f() {
    return this.api.get('/x')
  }
}
