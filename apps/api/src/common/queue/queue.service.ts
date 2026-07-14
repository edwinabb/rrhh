import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConnectionOptions, Queue } from 'bullmq';
import { QUEUE_CONNECTION } from './queue.constants';

/**
 * Registro central de colas — cada módulo de dominio (Fase 1: cierre de planilla,
 * Fase 3: firma masiva...) pide su Queue aquí en vez de instanciar BullMQ.Queue
 * directamente, así todas comparten la misma conexión Redis.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();

  constructor(@Inject(QUEUE_CONNECTION) private readonly connection: ConnectionOptions) {}

  getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async onModuleDestroy() {
    await Promise.all(Array.from(this.queues.values()).map((q) => q.close()));
  }
}
