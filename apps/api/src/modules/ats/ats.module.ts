import { Module } from '@nestjs/common';
import { AtsController } from './ats.controller';
import { VacanteService } from './vacante.service';
import { CandidateService } from './candidate.service';
import {
  AnthropicLlmClient,
  CVParsingService,
  LLM_CLIENT,
} from './cv-parsing.service';

@Module({
  controllers: [AtsController],
  providers: [
    VacanteService,
    CandidateService,
    CVParsingService,
    // Conector real a la Claude API bajo el token LLM_CLIENT (patrón
    // BIOMETRIC_PROVIDER): en tests se registra un mock bajo el mismo token
    // sin tocar los consumidores. useFactory porque el constructor recibe un
    // objeto de opciones plano (no un provider de Nest).
    { provide: LLM_CLIENT, useFactory: () => new AnthropicLlmClient() },
  ],
  exports: [VacanteService, CandidateService, CVParsingService],
})
export class AtsModule {}
