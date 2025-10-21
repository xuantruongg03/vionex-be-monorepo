import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { nanoid } from 'nanoid';
import { ChatMessage, ReplyInfo } from './interface';
import SemanticService from './interfaces/SemanticGRPC';

@Injectable()
export class ChatService implements OnModuleInit {
    private roomMessages = new Map<string, ChatMessage[]>();
    private semanticService: SemanticService;

    constructor(@Inject('SEMANTIC_SERVICE') private client: ClientGrpc) {}

    onModuleInit() {
        this.semanticService =
            this.client.getService<SemanticService>('SemanticService');
    }

    async saveMessage(
        room_id: string,
        sender: string,
        sender_name: string,
        text: string,
        org_id?: string,
        fileUrl?: string,
        fileName?: string,
        fileType?: string,
        fileSize?: number,
        isImage?: boolean,
        replyTo?: ReplyInfo,
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
                replyTo,
            };

            // Save to semantic service (not including files/images)
            if (this.semanticService && !fileUrl && !isImage) {
                this.semanticService
                    .saveTranscript({
                        room_id: newMessage.room_id,
                        speaker: newMessage.sender_name,
                        text: newMessage.text,
                        timestamp: newMessage.timestamp,
                        organization_id: org_id,
                    })
                    .subscribe({
                        error: (err) =>
                            console.error(
                                'Error saving message to semantic service:',
                                err,
                            ),
                    });
            }

            // Save to in-memory store to display to clients
            if (this.roomMessages.has(room_id)) {
                this.roomMessages.get(room_id)?.push(newMessage);
            } else {
                this.roomMessages.set(room_id, [newMessage]);
            }

            // This is to limit memory usage
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
