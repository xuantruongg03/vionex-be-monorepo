import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { InteractionModule } from './interaction.module';
import { protoPaths } from './common/paths';

async function bootstrap() {
  await ConfigModule.forRoot({
    isGlobal: true,
  });
  const configService = new ConfigService();

  const grpcApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    InteractionModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'interaction',
        protoPath: protoPaths.interaction,
        url: `0.0.0.0:${configService.get('INTERACTION_GRPC_PORT') || 30003}`,
        loader: {
          keepCase: true,
        },
      },
    },
  );
  await grpcApp.listen();
  console.log(
    `Interaction gRPC Service is running on port ${configService.get('INTERACTION_GRPC_PORT') || 30003}`,
  );
}
bootstrap();
