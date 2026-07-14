import { Module } from '@nestjs/common';
import { NormativeParameterService } from './normative-parameter.service';
import { NormativeParamsController } from './normative-params.controller';

@Module({
  controllers: [NormativeParamsController],
  providers: [NormativeParameterService],
  exports: [NormativeParameterService],
})
export class NormativeParamsModule {}
