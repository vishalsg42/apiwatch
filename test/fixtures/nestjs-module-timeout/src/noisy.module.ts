import { Module } from '@nestjs/common'
import { ALSO_OUTSIDE, OUTSIDE } from './outside'

// Both arrays are assembled in another file, so neither can be read here. This module never
// names HttpModule, so it cannot register one, and it must not make the whole repository abstain.
@Module({
  imports: [...OUTSIDE],
  providers: [...ALSO_OUTSIDE],
})
export class NoisyModule {}
