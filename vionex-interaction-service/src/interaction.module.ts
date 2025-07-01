import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { InteractionController } from './interaction.controller';
import { InteractionService } from './interaction.service';
import { WhiteboardService } from './services/whiteboard.service';
import { VotingService } from './services/voting.service';
import { QuizService } from './services/quiz.service';
import { BehaviorService } from './services/behavior.service';
import { RoomClientService } from './clients/room.client';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { protoPaths } from './common/paths';

@Module({
  imports: [
    ConfigModule.forRoot(),
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
    ]),
  ],
  controllers: [InteractionController],
  providers: [
    InteractionService,
    WhiteboardService,
    VotingService,
    QuizService,
    BehaviorService,
    RoomClientService,
  ],
  exports: [WhiteboardService, VotingService, QuizService, BehaviorService],
})
export class InteractionModule {}
