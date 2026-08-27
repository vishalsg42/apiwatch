import { HttpModule } from '@nestjs/axios'
import { Global, Module } from '@nestjs/common'

// @Global() makes this module's EXPORTS reachable everywhere with no imports edge.
@Global()
@Module({
  imports: [HttpModule.register({ timeout: 6000 })],
  exports: [HttpModule],
})
export class CoreModule {}
