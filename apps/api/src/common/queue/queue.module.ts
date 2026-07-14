import { Global, Module } from '@nestjs/common';
import { QUEUE_CONNECTION } from './queue.constants';
import { QueueService } from './queue.service';
import { ExampleProcessor } from './example.processor';

/**
 * Plumbing de Fase 0: conexión a Redis + patrón para registrar colas/jobs.
 * Los jobs pesados reales (cierre de planilla, firma masiva, archivos SUNAT)
 * se implementan en sus fases respectivas — este módulo solo entrega el cable.
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      useFactory: () => ({
        host: new URL(process.env.REDIS_URL ?? 'redis://localhost:6379').hostname,
        port: Number(new URL(process.env.REDIS_URL ?? 'redis://localhost:6379').port || 6379),
      }),
    },
    QueueService,
    ExampleProcessor,
  ],
  exports: [QUEUE_CONNECTION, QueueService],
})
export class QueueModule {}
