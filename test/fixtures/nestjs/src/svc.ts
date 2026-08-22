import { HttpService } from '@nestjs/axios'
export class S {
  constructor(private httpService: HttpService) {}
  f() {
    return this.httpService.get('https://x.dev/a')
  }
}
