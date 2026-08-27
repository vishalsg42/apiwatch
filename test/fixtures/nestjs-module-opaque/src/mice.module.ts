import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { USE_CASES } from './use-cases'

@Module({
  imports: [HttpModule.register({ timeout: 7000 })],
  providers: [...USE_CASES],
})
export class MiceModule {}
