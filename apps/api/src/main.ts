import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import RedisStore from 'connect-redis';
import Redis from 'ioredis';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const redisClient = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const redisStore = new RedisStore({ client: redisClient, prefix: 'rrhh-sess:' });

  app.use(
    session({
      store: redisStore,
      secret: process.env.SESSION_SECRET ?? 'dev-only-secret-nunca-usar-en-produccion',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60 * 8, // 8 horas
      },
    }),
  );

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API escuchando en http://localhost:${port}/api`);
}

bootstrap();
