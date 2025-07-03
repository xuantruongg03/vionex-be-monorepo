import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { SfuModule } from './sfu.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { protoPaths } from './common/paths';

async function bootstrap() {
  await ConfigModule.forRoot({
    isGlobal: true,
  });
  const configService = new ConfigService();

  // Create microservice application (gRPC only, no HTTP/WebSocket)
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    SfuModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'sfu',
        protoPath: protoPaths.sfu,
        url: `0.0.0.0:${configService.get('SFU_GRPC_PORT') || 30004}`,
        loader: {
          keepCase: true,
        },
      },
    },
  );

  // Start gRPC microservice only
  await app.listen();

  console.log(
    `Started SFU - gRPC port: ${configService.get('SFU_GRPC_PORT') || 30004}`,
  );
}
bootstrap();
