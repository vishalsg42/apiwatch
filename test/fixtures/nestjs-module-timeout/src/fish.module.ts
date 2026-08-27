import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { FishService } from './fish.service'

@Module({
  imports: [HttpModule.register({ timeout: 0 })],
  providers: [FishService],
})
export class FishModule {}
