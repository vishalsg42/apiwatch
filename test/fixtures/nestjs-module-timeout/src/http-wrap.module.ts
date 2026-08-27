import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'

@Module({
  imports: [HttpModule.register({ timeout: 9000 })],
  exports: [HttpModule],
})
export class HttpWrapModule {}
