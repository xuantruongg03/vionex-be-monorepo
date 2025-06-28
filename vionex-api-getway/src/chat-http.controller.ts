import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ChatClientService } from './clients/chat.client';
import { HttpBroadcastService } from './services/http-broadcast.service';

interface ChatMessage {
  id: string;
  room_id: string;
  sender: string;
  sender_name: string;
  text: string;
  timestamp?: string; // Make optional to match interface
}

interface SendMessageDto {
  room_id: string;
  sender: string;
  sender_name: string;
  text: string;
}

interface GetMessagesResponse {
  success: boolean;
  messages?: ChatMessage[];
  error?: string;
}

interface SendMessageResponse {
  success: boolean;
  message?: ChatMessage;
  error?: string;
}

@Controller('api/chat')
export class ChatHttpController {
  constructor(
    private readonly chatClient: ChatClientService,
    private readonly broadcastService: HttpBroadcastService,
  ) {}

  @Post('send')
  async sendMessage(
    @Body() data: SendMessageDto,
  ): Promise<SendMessageResponse> {
    try {
      if (!data.room_id || !data.sender || !data.text?.trim()) {
        throw new HttpException(
          'Room ID, sender, and message text are required',
          HttpStatus.BAD_REQUEST,
        );
      } // Save message via gRPC to chat service
      const result = await this.chatClient.sendMessage({
        room_id: data.room_id,
        sender: data.sender,
        sender_name: data.sender_name || 'Anonymous',
        text: data.text.trim(),
      });
      if (!result.success || !result.message) {
        throw new HttpException(
          'Failed to save message',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Broadcast the new message to all room participants via WebSocket
      this.broadcastService.broadcastToRoom(data.room_id, 'chat:new-message', {
        message: result.message,
      });

      return {
        success: true,
        message: result.message,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error sending chat message:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('messages/:roomId')
  async getMessages(
    @Param('roomId') roomId: string,
  ): Promise<GetMessagesResponse> {
    try {
      if (!roomId) {
        throw new HttpException('Room ID is required', HttpStatus.BAD_REQUEST);
      }

      const result = await this.chatClient.getMessages({ room_id: roomId });

      if (!result.success) {
        throw new HttpException(
          result.messages || 'Failed to get messages',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return {
        success: true,
        messages: result.messages || [],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error getting chat messages:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('messages/:roomId')
  async clearMessages(
    @Param('roomId') roomId: string,
  ): Promise<{ success: boolean }> {
    try {
      if (!roomId) {
        throw new HttpException('Room ID is required', HttpStatus.BAD_REQUEST);
      }

      const result = await this.chatClient.removeRoomMessages({
        room_id: roomId,
      });

      if (!result.success) {
        throw new HttpException(
          result.message || 'Failed to clear messages',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Broadcast that messages were cleared
      this.broadcastService.broadcastToRoom(roomId, 'chat:messages-cleared', {
        room_id: roomId,
      });

      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error clearing chat messages:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
