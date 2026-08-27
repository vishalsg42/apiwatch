import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { OwnService } from './own.service'

// An explicit bare HttpModule import is this module's own, unconfigured instance. It wins over
// whatever the global module exports, so calls here still have no deadline.
@Module({
  imports: [HttpModule],
  providers: [OwnService],
})
export class OwnModule {}
