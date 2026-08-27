import { Module } from '@nestjs/common'
import { ReaderService } from './reader.service'

// Imports neither HttpModule nor CoreModule, and still receives CoreModule's configured
// HttpService. This is sf-nest-admin's shape.
@Module({
  providers: [ReaderService],
})
export class ReaderModule {}
