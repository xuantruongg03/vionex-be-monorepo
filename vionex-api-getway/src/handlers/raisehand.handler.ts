import { Socket } from 'socket.io';
import { ChatClientService } from '../clients/chat.client';
import { WebSocketEventService } from '../services/websocket-event.service';
import { Injectable } from '@nestjs/common';
import { GatewayHelperService } from 'src/helpers/gateway.helper';
import { logger } from '../utils/log-manager';

@Injectable()
export class RaiseHandHandler {
    constructor(
        private readonly eventService: WebSocketEventService,
        private readonly helperService: GatewayHelperService,
    ) {
        logger.info(
            'raisehand.handler.ts',
            '[RaiseHandHandler] RaiseHandHandler initialized as service',
        );
    }

    async handleToggleRaiseHand(
        client: Socket,
        data: {
            roomId: string;
            userId: string;
            isRaised: boolean;
        },
    ) {
        try {
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );

            if (!peerId) {
                logger.warn(
                    'raisehand.handler.ts',
                    `[RAISE_HAND] User not authenticated, socket: ${client.id}`,
                );
                this.eventService.emitToClient(
                    client,
                    'interaction:raise-hand-error',
                    {
                        message: 'User not authenticated',
                    },
                );
                return;
            }

            // Broadcast to room about hand state change
            const eventName = data.isRaised
                ? 'interaction:hand-raised'
                : 'interaction:hand-lowered';

            const broadcastData = {
                userId: data.userId,
                peerId: peerId,
                timestamp: new Date().toISOString(),
            };

            this.eventService.broadcastToRoom(
                client,
                data.roomId,
                eventName,
                broadcastData,
            );

            return {
                success: true,
                message: 'Hand state updated successfully',
            };
        } catch (error) {
            logger.error(
                'raisehand.handler.ts',
                'Error toggling raise hand',
                error,
            );
            this.eventService.emitToClient(
                client,
                'interaction:raise-hand-error',
                {
                    message: error.message || 'Failed to toggle raise hand',
                },
            );
        }
    }
}
