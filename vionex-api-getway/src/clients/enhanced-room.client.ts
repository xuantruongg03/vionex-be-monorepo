
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { CircuitBreaker, RetryUtil } from '../utils/resilience';
import { RoomGrpcService } from 'src/interfaces/interface';

@Injectable()
export class EnhancedRoomClientService implements OnModuleInit {
  private roomService: RoomGrpcService;
  private circuitBreaker = new CircuitBreaker(5, 60000);

  constructor(private client: ClientGrpc) {}

  onModuleInit() {
    this.roomService = this.client.getService('RoomService');
  }

  async getRoom(roomId: string) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(async () => {
        const response = await firstValueFrom(
          this.roomService.getRoom({ room_id: roomId })
        );
        
        // Ensure participants field always exists
        if (response.data && !response.data.participants) {
          response.data.participants = [];
        }
        
        return response;
      }, 3, 1000);
    });
  }

  async isRoomExists(roomId: string) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(async () => {
        const response = await firstValueFrom(
          this.roomService.isRoomExists({ room_id: roomId })
        ) as any;
        return response.is_exists;
      }, 2, 500);
    });
  }

  async createRoom() {
    return this.circuitBreaker.execute(async () => {
      return firstValueFrom(
        this.roomService.createRoom({})
      );
    });
  }

  // Add monitoring metrics
  getHealthStatus() {
    return {
      circuitBreakerState: this.circuitBreaker.getState(),
      serviceName: 'RoomService',
      timestamp: new Date().toISOString(),
    };
  }
}
