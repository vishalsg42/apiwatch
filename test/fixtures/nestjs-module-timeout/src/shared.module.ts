import { Module } from '@nestjs/common'
import { HttpWrapModule } from './http-wrap.module'
import { SharedService } from './shared.service'

@Module({
  imports: [HttpWrapModule],
  providers: [SharedService],
})
export class SharedModule {}
