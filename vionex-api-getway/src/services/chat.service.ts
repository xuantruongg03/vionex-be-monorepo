import { Injectable } from '@nestjs/common';
import { ChatClientService } from 'src/clients/chat.client';

@Injectable()
export class ChatService {
  constructor(private readonly chatClient: ChatClientService) {}

  async sendMessage(
    roomId: string,
    sender: string,
    message: string,
    senderName: string,
  ) {
    return await this.chatClient.sendMessage({room_id: roomId, sender: sender, text: message, sender_name: senderName});
  }

  async getAllMessages(roomId: string) {
    return await this.chatClient.getMessages({room_id: roomId});
  }

  async removeRoomMessages(roomId: string) {
    return await this.chatClient.removeRoomMessages({room_id: roomId});
  }
}
