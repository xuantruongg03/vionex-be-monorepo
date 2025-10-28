import { Socket } from 'socket.io';
import { ChatClientService } from '../clients/chat.client';
import { WebSocketEventService } from '../services/websocket-event.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatHandler {
    constructor(
        private readonly chatClient: ChatClientService,
        private readonly eventService: WebSocketEventService,
    ) {
        console.log('[ChatHandler] ChatHandler initialized as service');
    }

    /**
     * Join chat room
     */
    async handleJoinRoom(
        client: Socket,
        data: { roomId: string; userName: string },
    ) {
        try {
            // Join socket.io room
            client.join(data.roomId);

            // Get chat history and send to user
            const response = await this.chatClient.getMessages({
                room_id: data.roomId,
            });

            if (response && response.success) {
                // Send chat history to joining user
                client.emit('chat:history', response.messages || []);
            }

            return { success: true };
        } catch (error) {
            console.error('[ChatHandler] Error joining chat room:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Leave chat room
     */
    async handleLeaveRoom(client: Socket, data: { roomId: string }) {
        try {
            // Leave socket.io room
            client.leave(data.roomId);

            return { success: true };
        } catch (error) {
            console.error('[ChatHandler] Error leaving chat room:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send text message
     */
    async handleSendMessage(
        client: Socket,
        data: {
            roomId: string;
            roomKey?: string; // NEW: Room key for semantic context isolation
            message: {
                sender: string;
                senderName: string;
                text: string;
                replyTo?: {
                    messageId: string;
                    senderName: string;
                    text: string;
                    isFile?: boolean;
                };
            };
            organizationId?: string;
        },
    ) {
        try {
            // Validate input
            if (!data.roomId || !data.message || !data.message.text) {
                this.eventService.emitError(
                    client,
                    'Invalid message data',
                    'INVALID_MESSAGE_DATA',
                );
                return { success: false, error: 'Invalid message data' };
            }

            const response = await this.chatClient.sendMessage({
                room_id: data.roomId,
                room_key: data.roomKey, // NEW: Pass room_key
                sender: data.message.sender,
                sender_name: data.message.senderName,
                text: data.message.text,
                // Pass reply data as replyTo object
                replyTo: data.message.replyTo,
                org_id: data.organizationId, // Pass organizationId to chat service
            });

            if (response && (response.success || response.message)) {
                // Extract the actual message object - handle both response formats
                let actualMessage: any = null;

                if ('message' in response && response.message) {
                    // Response has message property
                    actualMessage = response.message;
                } else if ('sender_name' in response) {
                    // Response is the message itself
                    actualMessage = response;
                }

                if (!actualMessage) {
                    this.eventService.emitError(
                        client,
                        'Failed to send message',
                        'SEND_MESSAGE_FAILED',
                    );
                    return { success: false, error: 'No message in response' };
                }

                const messageToEmit = {
                    ...actualMessage,
                    // Map snake_case to camelCase for frontend compatibility
                    senderName: actualMessage.sender_name,
                    roomId: actualMessage.room_id,
                    // Ensure reply data is included in the emitted message
                    replyTo: data.message.replyTo,
                };

                // Broadcast message to all users in room (including sender)
                this.eventService.emitToClient(
                    client,
                    'chat:message',
                    messageToEmit,
                );
                client.to(data.roomId).emit('chat:message', messageToEmit);

                return { success: true, message: messageToEmit };
            } else {
                console.error('[ChatHandler] Chat service failed:', response);
                this.eventService.emitError(
                    client,
                    'Failed to send message',
                    'SEND_MESSAGE_FAILED',
                );
                return { success: false, error: 'Failed to send message' };
            }
        } catch (error) {
            console.error('[ChatHandler] Error sending text message:', error);
            this.eventService.emitError(
                client,
                'Internal server error',
                'SEND_MESSAGE_ERROR',
            );
            return { success: false, error: error.message };
        }
    }

    /**
     * Send file message
     */
    async handleSendFileMessage(
        client: Socket,
        data: {
            roomId: string;
            roomKey?: string; // NEW: Room key for semantic context isolation
            message: {
                sender: string;
                senderName: string;
                text: string;
                fileUrl: string;
                fileName: string;
                fileType: string;
                fileSize: number;
                isImage: boolean;
                replyTo?: {
                    messageId: string;
                    senderName: string;
                    text: string;
                    isFile?: boolean;
                };
            };
            organizationId?: string; // Add organizationId parameter
        },
    ) {
        try {
            const response = await this.chatClient.sendMessage({
                room_id: data.roomId,
                room_key: data.roomKey, // NEW: Pass room_key
                sender: data.message.sender,
                sender_name: data.message.senderName,
                text: data.message.text,
                fileUrl: data.message.fileUrl,
                fileName: data.message.fileName,
                fileType: data.message.fileType,
                fileSize: data.message.fileSize,
                isImage: data.message.isImage,
                // Pass reply data as replyTo object
                replyTo: data.message.replyTo,
                org_id: data.organizationId, // Pass organizationId to chat service
            });

            if (response && response.success && response.message) {
                const messageToEmit = {
                    ...response.message,
                    // Map snake_case to camelCase for frontend compatibility
                    senderName: response.message.sender_name,
                    roomId: response.message.room_id,
                    // Ensure reply data is included in the emitted message
                    replyTo: data.message.replyTo,
                };

                // Broadcast file message to all users in room (including sender)
                this.eventService.emitToClient(
                    client,
                    'chat:message',
                    messageToEmit,
                );
                client.to(data.roomId).emit('chat:message', messageToEmit);

                return { success: true, message: messageToEmit };
            } else {
                this.eventService.emitError(
                    client,
                    'Failed to send file message',
                    'SEND_FILE_MESSAGE_FAILED',
                );
                return { success: false, error: 'Failed to send file message' };
            }
        } catch (error) {
            console.error('[ChatHandler] Error sending file message:', error);
            this.eventService.emitError(
                client,
                'Internal server error',
                'SEND_FILE_MESSAGE_ERROR',
            );
            return { success: false, error: error.message };
        }
    }
}
