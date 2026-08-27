import { HttpService } from '@nestjs/axios'
export class ReaderService {
  constructor(private readonly httpService: HttpService) {}
  all() {
    return this.httpService.axiosRef.get('https://api.example.dev/reader')
  }
}
