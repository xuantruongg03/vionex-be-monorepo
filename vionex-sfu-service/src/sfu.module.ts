import { Module } from '@nestjs/common';
import { SfuController } from './sfu.controller';
import { SfuService } from './sfu.service';
import { WorkerPoolService } from './worker-pool/worker-pool.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { protoPaths } from './common/paths';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ClientsModule.registerAsync([
      {
        name: 'ROOM_SERVICE',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'room',
            protoPath: protoPaths.room,
            url: `${configService.get('ROOM_HOST') || 'localhost'}:${configService.get('ROOM_GRPC_PORT') || 50051}`,
            loader: {
              keepCase: true,
            },
          },
        }),
      },
    ]),
  ],
  controllers: [SfuController],
  providers: [
    WorkerPoolService, // List WorkerPoolService first to ensure it's initialized before services that depend on it
    SfuService,
    ConfigService,
  ],
})
export class SfuModule {}
