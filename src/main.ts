import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('nodeEnv', 'development');
  const frontendOrigin = config.get<string>('frontendOrigin', 'http://localhost:3000');

  app.enableCors({
    origin: nodeEnv === 'production' ? frontendOrigin : true,
    credentials: true,
  });

  const port = config.get<number>('port', 3001);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
