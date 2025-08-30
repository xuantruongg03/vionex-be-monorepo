import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AudioClientService } from './clients/audio.client';
import { ChatClientService } from './clients/chat.client';
import { InteractionClientService } from './clients/interaction.client';
import { RoomClientService } from './clients/room.client';
import { SfuClientService } from './clients/sfu.client';
import { OrganizationClientService } from './clients/organization.client';
import { protoPaths } from './common/paths';
import { GatewayController } from './gateway.controller';
import { GatewayGateway } from './gateway.gateway';
import { RoomHttpController } from './room-http.controller';
import { OrganizationController } from './organization.controller';
import { ChatService } from './services/chat.service';
import { HttpBroadcastService } from './services/http-broadcast.service';
import { WebSocketEventService } from './services/websocket-event.service';
import { StreamService } from './services/stream.service';
import { ServiceErrorService } from './services/service-error.service';
import { ChatBotClientService } from './clients/chatbot.client';
import { AuthController } from './auth.controller';
import { AuthClientService } from './clients/auth.client';
import { ChatHandler } from './handlers/chat.handler';
import { VotingHandler } from './handlers/voting.handler';
import { GatewayHelperService } from './helpers/gateway.helper';

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
                        url: `${configService.get('ROOM_SERVICE_HOST') || 'localhost'}:${configService.get('ROOM_SERVICE_GRPC_PORT') || 30001}`,
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
                        url: `${configService.get('CHAT_SERVICE_HOST') || 'localhost'}:${configService.get('CHAT_SERVICE_GRPC_PORT') || 30002}`,
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
                        url: `${configService.get('SFU_SERVICE_HOST') || 'localhost'}:${configService.get('SFU_SERVICE_GRPC_PORT') || 30004}`,
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
                        url: `${configService.get('INTERACTION_SERVICE_HOST') || 'localhost'}:${configService.get('INTERACTION_SERVICE_GRPC_PORT') || 30003}`,
                        loader: {
                            keepCase: true,
                        },
                    },
                }),
                inject: [ConfigService],
            },
            {
                name: 'AUDIO_SERVICE',
                imports: [ConfigModule],
                useFactory: (configService: ConfigService) => ({
                    transport: Transport.GRPC,
                    options: {
                        package: 'audio',
                        protoPath: protoPaths.audio,
                        url: `${configService.get('AUDIO_SERVICE_HOST') || 'localhost'}:${configService.get('AUDIO_SERVICE_GRPC_PORT') || 30005}`,
                        loader: {
                            keepCase: true,
                        },
                    },
                }),
                inject: [ConfigService],
            },
            {
                name: 'CHATBOT_SERVICE',
                imports: [ConfigModule],
                useFactory: (configService: ConfigService) => ({
                    transport: Transport.GRPC,
                    options: {
                        package: 'chatbot',
                        protoPath: protoPaths.chatbot,
                        url: `${configService.get('CHATBOT_SERVICE_HOST') || 'localhost'}:${configService.get('CHATBOT_SERVICE_GRPC_PORT') || 30007}`,
                        loader: {
                            keepCase: true,
                        },
                    },
                }),
                inject: [ConfigService],
            },
            {
                name: 'AUTH_SERVICE',
                imports: [ConfigModule],
                useFactory: (configService: ConfigService) => ({
                    transport: Transport.GRPC,
                    options: {
                        package: 'auth',
                        protoPath: protoPaths.auth,
                        url: `${configService.get('AUTH_SERVICE_HOST') || 'localhost'}:${configService.get('AUTH_SERVICE_GRPC_PORT') || 30008}`,
                        loader: {
                            keepCase: true,
                        },
                    },
                }),
                inject: [ConfigService],
            },
        ]),
    ],
    controllers: [
        GatewayController,
        RoomHttpController,
        AuthController,
        OrganizationController,
    ],
    providers: [
        GatewayGateway,
        ChatService,
        AudioClientService,
        WebSocketEventService,
        RoomClientService,
        ChatClientService,
        HttpBroadcastService,
        SfuClientService,
        InteractionClientService,
        ChatBotClientService,
        AuthClientService,
        OrganizationClientService,
        ChatHandler,
        VotingHandler,
        GatewayHelperService,
        StreamService,
        ServiceErrorService,
    ],
})
export class GatewayModule {}
