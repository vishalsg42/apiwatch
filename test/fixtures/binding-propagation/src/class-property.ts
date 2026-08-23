import axios from 'axios'
export class Svc {
  private api = axios.create({ timeout: 5000 })
  load() { return this.api.get('https://x.dev/a') }
}
