import { Module } from '@nestjs/common';
import { VacationsController } from './vacations.controller';
import { VacationsService } from './vacations.service';
import { NormativeParamsModule } from '../normative-params/normative-params.module';

@Module({
  imports: [NormativeParamsModule],
  controllers: [VacationsController],
  providers: [VacationsService],
  exports: [VacationsService],
})
export class VacationsModule {}
