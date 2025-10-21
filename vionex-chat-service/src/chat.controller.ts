import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { ChatService } from './chat.service';
import { ChatMessage, ChatMessageResponse, ReplyInfo } from './interface';

@Controller()
export class ChatController {
    constructor(private readonly chatService: ChatService) {}

    @GrpcMethod('ChatService', 'SendMessage')
    async sendMessage(data: {
        room_id: string;
        sender: string;
        sender_name: string;
        text: string;
        org_id?: string;
        fileUrl?: string;
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        isImage?: boolean;
        replyTo?: ReplyInfo;
    }): Promise<ChatMessageResponse> {
        const rs = await this.chatService.saveMessage(
            data.room_id,
            data.sender,
            data.sender_name,
            data.text,
            data.org_id,
            data.fileUrl,
            data.fileName,
            data.fileType,
            data.fileSize,
            data.isImage,
            data.replyTo,
        );
        if (!rs) {
            return {
                success: false,
                message: null,
            };
        }
        return {
            success: true,
            message: rs,
        };
    }
    @GrpcMethod('ChatService', 'GetMessages')
    async getMessages(data: {
        room_id: string;
    }): Promise<{ success: boolean; messages: ChatMessage[] }> {
        try {
            const messages = await this.chatService.getAllMessages(
                data.room_id,
            );
            return {
                success: true,
                messages: messages,
            };
        } catch (error) {
            console.error('Error getting messages:', error);
            return {
                success: false,
                messages: [],
            };
        }
    }

    @GrpcMethod('ChatService', 'RemoveRoomMessages')
    async removeRoomMessages(data: {
        room_id: string;
    }): Promise<{ success: boolean; message: string }> {
        try {
            await this.chatService.removeRoomMessages(data.room_id);
            return {
                success: true,
                message: 'Messages removed successfully',
            };
        } catch (error) {
            console.error('Error removing messages:', error);
            return {
                success: false,
                message: 'Failed to remove messages',
            };
        }
    }
}
