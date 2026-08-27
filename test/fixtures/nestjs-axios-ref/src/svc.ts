import { HttpService } from '@nestjs/axios'

export class S {
  constructor(private readonly httpService: HttpService) {}

  bare() {
    return this.httpService.axiosRef.get('https://x.dev/bare')
  }

  withTimeout() {
    return this.httpService.axiosRef.get('https://x.dev/t', { timeout: 3000 })
  }

  viaRequest() {
    return this.httpService.axiosRef.request({
      method: 'post',
      url: 'https://x.dev/r',
      timeout: 2000,
    })
  }

  posting(body: unknown) {
    return this.httpService.axiosRef.post('https://x.dev/p', body, { timeout: 1000 })
  }

  chained() {
    return this.httpService.axiosRef
      .get('https://x.dev/chained')
  }
}
