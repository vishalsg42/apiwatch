import { HttpService } from '@nestjs/axios'
export class StrayService {
  constructor(private readonly httpService: HttpService) {}
  all() {
    return this.httpService.get('https://api.example.dev/stray')
  }
}
