import { Module } from '@nestjs/common';
import { TerminationController } from './termination.controller';
import { TerminationService } from './termination.service';
import { CeseDocumentsService } from './cese-documents.service';
import { NormativeParamsModule } from '../normative-params/normative-params.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [NormativeParamsModule, DocumentsModule],
  controllers: [TerminationController],
  providers: [TerminationService, CeseDocumentsService],
})
export class TerminationModule {}
