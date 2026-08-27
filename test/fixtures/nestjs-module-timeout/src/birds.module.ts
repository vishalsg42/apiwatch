import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { BirdsService } from './birds.service'

@Module({
  imports: [
    HttpModule.registerAsync({
      useFactory: () => ({ timeout: 5000 }),
    }),
  ],
  providers: [BirdsService],
})
export class BirdsModule {}
