import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { OwlsController } from './owls.controller'

@Module({
  imports: [HttpModule.register({ timeout: 4000 })],
  controllers: [OwlsController],
})
export class OwlsModule {}
