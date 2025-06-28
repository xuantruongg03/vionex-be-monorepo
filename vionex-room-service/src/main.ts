import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { RoomModule } from './room.module';
import { join } from 'path';
import { protoPaths } from './common/paths';

async function bootstrap() {
  await ConfigModule.forRoot({
    isGlobal: true,
  });
  const configService = new ConfigService();

  // Create gRPC microservice
  const grpcApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    RoomModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'room',
        protoPath: protoPaths.room,
        url: `0.0.0.0:${configService.get('ROOM_GRPC_PORT') || 50051}`,
        loader: {
          keepCase: true,
        },
      },
    },
  );

  // Start both HTTP and gRPC services
  await grpcApp.listen();
  console.log(
    `Room gRPC Service is running on port ${configService.get('ROOM_GRPC_PORT') || 50051}`,
  );
}
bootstrap();
