import { NestFactory } from '@nestjs/core';
import { ChatModule } from './chat.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { protoPaths } from './common/paths';

async function bootstrap() {
  await ConfigModule.forRoot({
    isGlobal: true,
  });
  const configService = new ConfigService();

  const grpcApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    ChatModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'chat',
        protoPath: protoPaths.chat,
        url: `0.0.0.0:${configService.get('CHAT_GRPC_PORT') || 50054}`,
        loader: {
          keepCase: true,
        },
      },
    },
  );
  await grpcApp.listen();
  console.log(
    `Chat gRPC Service is running on port ${configService.get('CHAT_GRPC_PORT') || 50054}`,
  );
}
bootstrap();
