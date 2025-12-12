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
        logger.info(
            'chatbot.handler.ts',
            '[ChatBotHandler] ChatBotHandler initialized as service',
        );
    }

    async handleAskChatBot(
        client: Socket,
        data: {
            id: string;
            roomId: string;
            roomKey?: string; // NEW: Room key for semantic context isolation
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
                room_key: data.roomKey, // NEW: Pass room_key
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

    async handleExtractMeetingSummary(
        client: Socket,
        data: {
            roomId: string;
            roomKey?: string;
            organizationId?: string;
        },
    ) {
        try {
            logger.info(
                'chatbot.handler.ts',
                `Extract meeting summary request from ${client.id} for room ${data.roomId}`,
            );

            // Security: Validate user is in the room
            const socketRooms = Array.from(client.rooms);
            if (!socketRooms.includes(data.roomId)) {
                logger.warn(
                    'chatbot.handler.ts',
                    `Summary extraction denied - client ${client.id} not in room ${data.roomId}`,
                );
                this.eventService.emitToClient(
                    client,
                    'chatbot:summary:error',
                    {
                        message: 'Access denied: You are not in this room',
                    },
                );
                return;
            }

            // Get peerId from socket data
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            if (!peerId) {
                this.eventService.emitToClient(
                    client,
                    'chatbot:summary:error',
                    {
                        message: 'User not authenticated',
                    },
                );
                return;
            }

            // Call chatbot service to extract summary
            logger.debug(
                'chatbot.handler.ts',
                `Extracting meeting summary for room ${data.roomId}`,
            );

            const response = await this.chatbotClient.extractMeetingSummary({
                room_id: data.roomId,
                room_key: data.roomKey,
                organization_id: data.organizationId,
            });

            // Parse and send the summary
            try {
                const summaryData = JSON.parse(response.summary_json);
                this.eventService.emitToClient(
                    client,
                    'chatbot:summary:success',
                    {
                        summary: summaryData,
                    },
                );

                logger.info(
                    'chatbot.handler.ts',
                    `Meeting summary extracted successfully for room ${data.roomId}`,
                );
            } catch (parseError) {
                logger.error(
                    'chatbot.handler.ts',
                    'Failed to parse summary JSON',
                    parseError,
                );
                this.eventService.emitToClient(
                    client,
                    'chatbot:summary:error',
                    {
                        message: 'Failed to parse summary data',
                    },
                );
            }
        } catch (error) {
            const handled = this.helperService.handleServiceError(
                client,
                error,
                'ChatBot Service',
                'chatbot:summary',
            );

            if (!handled) {
                logger.error(
                    'chatbot.handler.ts',
                    `Error extracting meeting summary for room ${data.roomId}`,
                    error,
                );

                this.eventService.emitToClient(
                    client,
                    'chatbot:summary:error',
                    {
                        message: 'Failed to extract meeting summary',
                    },
                );
            }
        }
    }

    async handleGenerateMeetingReport(
        client: Socket,
        data: {
            roomId: string;
            roomKey: string;
            organizationId?: string;
        },
    ) {
        try {
            logger.info(
                'chatbot.handler.ts',
                `Generate meeting report request from ${client.id} for room ${data.roomId}`,
            );

            // Security: Validate user is in the room
            const socketRooms = Array.from(client.rooms);
            if (!socketRooms.includes(data.roomId)) {
                logger.warn(
                    'chatbot.handler.ts',
                    `Report generation denied - client ${client.id} not in room ${data.roomId}`,
                );
                this.eventService.emitToClient(client, 'meeting:report:error', {
                    message: 'Access denied: You are not in this room',
                });
                return;
            }

            // Get peerId from socket data
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            if (!peerId) {
                this.eventService.emitToClient(client, 'meeting:report:error', {
                    message: 'User not authenticated',
                });
                return;
            }

            // Call chatbot service to generate report
            logger.debug(
                'chatbot.handler.ts',
                `Generating meeting report for room ${data.roomId}`,
            );

            const response = await this.chatbotClient.generateMeetingReport({
                room_id: data.roomId,
                room_key: data.roomKey,
                organization_id: data.organizationId,
            });

            if (response.success) {
                // Send the report content to client
                this.eventService.emitToClient(
                    client,
                    'meeting:report:success',
                    {
                        reportContent: response.report_content,
                    },
                );

                logger.info(
                    'chatbot.handler.ts',
                    `Meeting report generated successfully for room ${data.roomId}`,
                );
            } else {
                this.eventService.emitToClient(client, 'meeting:report:error', {
                    message:
                        response.error_message ||
                        'Failed to generate meeting report',
                });
            }
        } catch (error) {
            const handled = this.helperService.handleServiceError(
                client,
                error,
                'ChatBot Service',
                'meeting:report',
            );

            if (!handled) {
                logger.error(
                    'chatbot.handler.ts',
                    `Error generating meeting report for room ${data.roomId}`,
                    error,
                );

                this.eventService.emitToClient(client, 'meeting:report:error', {
                    message: 'Failed to generate meeting report',
                });
            }
        }
    }
}
