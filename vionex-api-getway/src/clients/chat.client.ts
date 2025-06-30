import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { ChatGRPCService } from 'src/interfaces/interface';
import { CircuitBreaker, RetryUtil } from 'src/utils/resilience';

@Injectable()
export class ChatClientService implements OnModuleInit {
  private chatService: ChatGRPCService;
  private circuitBreaker = new CircuitBreaker(5, 60000);

  constructor(@Inject('CHAT_SERVICE') private client: ClientGrpc) {}

  onModuleInit() {
    this.chatService = this.client.getService<ChatGRPCService>('ChatService');
  }

  async sendMessage(data: {
    room_id: string;
    sender: string;
    sender_name: string;
    text: string;
    fileUrl?: string;
    fileName?: string;
    fileType?: string;
    fileSize?: number;
    isImage?: boolean;
  }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.chatService.sendMessage(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }
  async getMessages(data: { room_id: string }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.chatService.getMessages(data),
          );
          return { success: true, messages: response.messages || [] };
        },
        3,
        1000,
      );
    });
  }

  async removeRoomMessages(data: { room_id: string }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.chatService.removeRoomMessages(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async joinRoom(data: { room_id: string; user_name: string }) {
    return { success: true, message: 'Joined chat room successfully' };
  }

  async leaveRoom(data: { room_id: string }) {
    return { success: true };
  }
}
