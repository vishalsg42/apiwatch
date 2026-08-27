import { HttpService } from '@nestjs/axios'
export class MiceService {
  constructor(private readonly httpService: HttpService) {}
  all() {
    return this.httpService.get('https://api.example.dev/mice')
  }
}
