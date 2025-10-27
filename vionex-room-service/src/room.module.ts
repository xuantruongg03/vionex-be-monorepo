import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config/dist/config.module';
import { ConfigService } from '@nestjs/config/dist/config.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { protoPaths } from './common/paths';
import { RoomGrpcController } from './room.controller';
import { RoomService } from './room.service';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ClientsModule.registerAsync([
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
        ]),
    ],
    controllers: [RoomGrpcController],
    providers: [RoomService, ConfigService],
})
export class RoomModule {}
