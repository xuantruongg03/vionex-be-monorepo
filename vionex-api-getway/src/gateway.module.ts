import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { protoPaths } from './common/paths';
import { GatewayGateway } from './gateway.gateway';
import { ChatService } from './services/chat.service';
import { WebSocketEventService } from './services/websocket-event.service';
import { RoomClientService } from './clients/room.client';
import { ChatClientService } from './clients/chat.client';
import { InteractionClientService } from './clients/interaction.client';
import { GatewayController } from './gateway.controller';
import { RoomHttpController } from './room-http.controller';
import { HttpBroadcastService } from './services/http-broadcast.service';
import { SfuClientService } from './clients/sfu.client';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ClientsModule.registerAsync([
      {
        name: 'ROOM_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'room',
            protoPath: protoPaths.room,
            url: `${configService.get('ROOM_SERVICE_HOST') || 'localhost'}:${configService.get('ROOM_SERVICE_GRPC_PORT') || 50051}`,
            loader: {
              keepCase: true,
            },
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'CHAT_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'chat',
            protoPath: protoPaths.chat,
            url: `${configService.get('CHAT_SERVICE_HOST') || 'localhost'}:${configService.get('CHAT_SERVICE_GRPC_PORT') || 50054}`,
            loader: {
              keepCase: true,
            },
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'SFU_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'sfu',
            protoPath: protoPaths.sfu,
            url: `${configService.get('SFU_SERVICE_HOST') || 'localhost'}:${configService.get('SFU_SERVICE_GRPC_PORT') || 50053}`,
            loader: {
              keepCase: true,
            },
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'INTERACTION_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'interaction',
            protoPath: protoPaths.interaction,
            url: `${configService.get('INTERACTION_SERVICE_HOST') || 'localhost'}:${configService.get('INTERACTION_SERVICE_GRPC_PORT') || 50055}`,
            loader: {
              keepCase: true,
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [GatewayController, RoomHttpController],
  providers: [
    GatewayGateway,
    ChatService,
    WebSocketEventService,
    RoomClientService,
    ChatClientService,
    HttpBroadcastService,
    SfuClientService,
    InteractionClientService,
  ],
})
export class GatewayModule {}
