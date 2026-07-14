import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConnectionOptions, Worker } from 'bullmq';
import { QUEUE_CONNECTION } from './queue.constants';

/**
 * Processor de ejemplo: demuestra el patrón (nombre de cola, worker, logging)
 * que las fases siguientes copian para sus jobs reales. No se usa en producción.
 */
@Injectable()
export class ExampleProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExampleProcessor.name);
  private worker?: Worker;

  constructor(@Inject(QUEUE_CONNECTION) private readonly connection: ConnectionOptions) {}

  onModuleInit() {
    this.worker = new Worker(
      'example',
      async (job) => {
        this.logger.log(`Procesando job de ejemplo ${job.id}: ${JSON.stringify(job.data)}`);
      },
      { connection: this.connection },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
