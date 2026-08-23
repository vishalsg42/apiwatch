const { HttpService } = require('@nestjs/axios')
export class S {
  constructor(private httpService: HttpService) {}
  f() { return this.httpService.get('https://api.vendor.dev/a') }
}
