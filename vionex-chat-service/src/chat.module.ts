import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { protoPaths } from './common/paths';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        ClientsModule.registerAsync([
            {
                name: 'SEMANTIC_SERVICE',
                inject: [ConfigService],
                useFactory: (configService: ConfigService) => ({
                    transport: Transport.GRPC,
                    options: {
                        package: 'semantic',
                        protoPath: protoPaths.semantic,
                        url: `${configService.get('SEMANTIC_HOST') || 'localhost'}:${configService.get('SEMANTIC_PORT') || 30006}`,
                        loader: {
                            keepCase: true,
                        },
                    },
                }),
            },
        ]),
    ],
    controllers: [ChatController],
    providers: [ChatService],
})
export class ChatModule {}
