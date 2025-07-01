import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

interface RoomGrpcService {
  getParticipantByPeerId(data: { room_id: string; peer_id: string }): any;
  isRoomExists(data: { room_id: string }): any;
}

interface Participant {
  peer_id: string;
  socket_id: string;
  is_creator: boolean;
  time_arrive: Date;
}

@Injectable()
export class RoomClientService implements OnModuleInit {
  private roomService: RoomGrpcService;

  constructor(@Inject('ROOM_SERVICE') private client: ClientGrpc) {}

  onModuleInit() {
    this.roomService = this.client.getService<RoomGrpcService>('RoomService');
  }

  async getParticipantByPeerId(
    roomId: string,
    peerId: string,
  ): Promise<Participant | null> {
    try {
      const response: any = await firstValueFrom(
        this.roomService.getParticipantByPeerId({
          room_id: roomId,
          peer_id: peerId,
        }),
      );
      return response.participant || null;
    } catch (error) {
      console.log(
        `Participant with ID ${peerId} not found in room ${roomId}:`,
        error,
      );
      return null;
    }
  }

  async isRoomExists(roomId: string): Promise<boolean> {
    try {
      const response: any = await firstValueFrom(
        this.roomService.isRoomExists({ room_id: roomId }),
      );
      return response.is_exists;
    } catch (error) {
      console.log(`Room with ID ${roomId} does not exist:`, error);
      return false;
    }
  }
}
