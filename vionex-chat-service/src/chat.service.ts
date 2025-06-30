import { Injectable } from '@nestjs/common';
import { ChatMessage } from './interface';
import { nanoid } from 'nanoid';

@Injectable()
export class ChatService {
  private roomMessages = new Map<string, ChatMessage[]>();

  async saveMessage(
    room_id: string,
    sender: string,
    sender_name: string,
    text: string,
    fileUrl?: string,
    fileName?: string,
    fileType?: string,
    fileSize?: number,
    isImage?: boolean,
  ): Promise<ChatMessage | null> {
    try {
      const newMessage: ChatMessage = {
        id: nanoid(),
        room_id,
        sender,
        sender_name,
        text,
        timestamp: new Date().toISOString(),
        fileUrl,
        fileName,
        fileType,
        fileSize,
        isImage,
      };

      if (this.roomMessages.has(room_id)) {
        this.roomMessages.get(room_id)?.push(newMessage);
      } else {
        this.roomMessages.set(room_id, [newMessage]);
      }

      // Giới hạn kích thước lịch sử (chỉ lưu 100 tin nhắn gần nhất)
      const messages = this.roomMessages.get(room_id);
      if (messages && messages.length > 100) {
        this.roomMessages.set(room_id, messages.slice(-100));
      }

      return newMessage;
    } catch (error) {
      console.error('Error saving message:', error);
      return null;
    }
  }

  async getAllMessages(roomId: string): Promise<ChatMessage[]> {
    return this.roomMessages.get(roomId) || [];
  }

  async removeRoomMessages(roomId: string): Promise<void> {
    this.roomMessages.delete(roomId);
  }
}
