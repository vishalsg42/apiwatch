import { HttpService } from '@nestjs/axios'
export class BirdsService {
  constructor(private readonly httpService: HttpService) {}
  all() {
    return this.httpService.get('https://api.example.dev/birds')
  }
}
