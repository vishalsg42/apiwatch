import { HttpService } from '@nestjs/axios'
export class OwlsController {
  constructor(private readonly httpService: HttpService) {}
  all() {
    return this.httpService.get('https://api.example.dev/owls')
  }
}
