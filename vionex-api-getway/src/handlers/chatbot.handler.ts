import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { ChatBotClientService } from 'src/clients/chatbot.client';
import { WebSocketEventService } from '../services/websocket-event.service';
import { logger } from '../utils/log-manager';
import { GatewayHelperService } from 'src/helpers/gateway.helper';

@Injectable()
export class ChatBotHandler {
    constructor(
        private readonly chatbotClient: ChatBotClientService,
        private readonly eventService: WebSocketEventService,
        private readonly helperService: GatewayHelperService,
    ) {
        logger.info('chatbot.handler.ts', '[ChatBotHandler] ChatBotHandler initialized as service');
    }

    async handleAskChatBot(
        client: Socket,
        data: {
            id: string;
            roomId: string;
            text: string;
            organizationId?: string;
        },
    ) {
        try {
            logger.info(
                'chatbot.handler.ts',
                `Chatbot request from ${client.id}: ${JSON.stringify({
                    requestId: data.id,
                    roomId: data.roomId,
                    question: data.text?.substring(0, 100) + '...',
                })}`,
            );

            // Security: Validate user is in the room
            const socketRooms = Array.from(client.rooms);
            if (!socketRooms.includes(data.roomId)) {
                logger.warn(
                    'chatbot.handler.ts',
                    `Chatbot access denied - client ${client.id} not in room ${data.roomId}`,
                );
                this.eventService.emitToClient(client, 'chatbot:error', {
                    requestId: data.id,
                    message: 'Access denied: You are not in this room',
                });
                return;
            }

            // Validate input
            if (!data.text || data.text.trim().length === 0) {
                this.eventService.emitToClient(client, 'chatbot:error', {
                    requestId: data.id,
                    message: 'Question cannot be empty',
                });
                return;
            }

            if (data.text.length > 2000) {
                this.eventService.emitToClient(client, 'chatbot:error', {
                    requestId: data.id,
                    message: 'Question too long (max 2000 characters)',
                });
                return;
            }

            // Get peerId from socket data (set during join)
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            if (!peerId) {
                this.eventService.emitToClient(client, 'chatbot:error', {
                    requestId: data.id,
                    message: 'User not authenticated',
                });
                return;
            }

            // Call chatbot service
            logger.debug(
                'chatbot.handler.ts',
                `Processing chatbot request for user ${peerId} in room ${data.roomId}`,
            );

            const response = await this.chatbotClient.askChatBot({
                question: data.text.trim(),
                room_id: data.roomId,
                organization_id: data.organizationId,
            });

            // Send final response (for now, no streaming)
            // client.emit('chatbot:final', {
            //     requestId: data.id,
            //     text:
            //         response.answer ||
            //         'I apologize, but I could not generate a response.',
            // });
            this.eventService.emitToClient(client, 'chatbot:final', {
                requestId: data.id,
                text:
                    response.answer ||
                    'I apologize, but I could not generate a response.',
            });

            logger.info(
                'chatbot.handler.ts',
                `Chatbot response sent for request ${data.id}`,
            );
        } catch (error) {
            // Check if this is a service unavailability error
            const handled = this.helperService.handleServiceError(
                client,
                error,
                'ChatBot Service',
                'chatbot:ask',
            );

            if (!handled) {
                // Log other errors
                logger.error(
                    'chatbot.handler.ts',
                    `Error processing chatbot request ${data.id}`,
                    error,
                );

                let errorMessage =
                    'Sorry, I encountered an error while processing your request.';

                // Handle specific error types
                if (error.message?.includes('timeout')) {
                    errorMessage = 'Request timed out. Please try again.';
                } else if (error.message?.includes('rate limit')) {
                    errorMessage =
                        'Too many requests. Please wait a moment before asking again.';
                }

                this.eventService.emitToClient(client, 'chatbot:error', {
                    requestId: data.id,
                    message: errorMessage,
                });
            }
        }
    }

}
