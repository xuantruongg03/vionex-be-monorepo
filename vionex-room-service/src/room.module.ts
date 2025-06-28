import { Module } from '@nestjs/common';
import { RoomService } from './room.service';
import { RoomGrpcController } from './room.controller';

@Module({
  controllers: [RoomGrpcController],
  providers: [RoomService],
})
export class RoomModule {}