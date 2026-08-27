import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { DogsService } from './dogs.service'

@Module({
  imports: [HttpModule],
  providers: [DogsService],
})
export class DogsModule {}
