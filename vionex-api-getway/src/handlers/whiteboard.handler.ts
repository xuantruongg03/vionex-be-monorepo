import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { InteractionClientService } from '../clients/interaction.client';
import { WebSocketEventService } from '../services/websocket-event.service';
import { GatewayHelperService } from '../helpers/gateway.helper';

@Injectable()
export class WhiteboardHandler {
    constructor(
        private readonly interactionClient: InteractionClientService,
        private readonly eventService: WebSocketEventService,
        private readonly helperService: GatewayHelperService,
    ) {}

    async handleUpdateWhiteboard(
        client: Socket,
        data: {
            roomId: string;
            elements: any[];
            state: any;
            version?: number;
            timestamp?: number;
            fromUser?: string;
        },
    ) {
        try {
            // Validate user is in the room
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            const roomId = await this.helperService.getRoomIdBySocketId(
                client.id,
            );

            if (!peerId || !roomId || roomId !== data.roomId) {
                client.emit('whiteboard:error', {
                    message: 'Unauthorized access to whiteboard',
                });
                return;
            }

            // Check if user has permission to draw
            const hasPermission =
                await this.interactionClient.checkUserPermission(
                    data.roomId,
                    peerId,
                );

            if (!hasPermission?.success || !hasPermission?.can_draw) {
                client.emit('whiteboard:error', {
                    message: 'No permission to draw on whiteboard',
                });
                return;
            }

            // Update whiteboard data via interaction service
            const result = (await this.interactionClient.updateWhiteboard(
                data.roomId,
                data.elements,
                JSON.stringify(data.state || {}),
            )) as any;

            if (result?.success) {
                // Broadcast update to all clients in the room (including sender for confirmation)
                const updatePayload = {
                    roomId: data.roomId,
                    elements: data.elements,
                    state: data.state,
                    version: data.version || Date.now(),
                    timestamp: data.timestamp || Date.now(),
                    fromUser: data.fromUser || peerId,
                };

                this.eventService.broadcastToRoom(
                    client,
                    data.roomId,
                    'whiteboard:updated',
                    updatePayload,
                );
            } else {
                client.emit('whiteboard:error', {
                    message: 'Failed to update whiteboard',
                });
            }
        } catch (error) {
            client.emit('whiteboard:error', {
                message: 'Internal server error',
            });
        }
    }

    async handleGetWhiteboardData(client: Socket, data: { roomId: string }) {
        try {
            // Validate user is in the room
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            const roomId = await this.helperService.getRoomIdBySocketId(
                client.id,
            );

            if (!peerId || !roomId || roomId !== data.roomId) {
                client.emit('whiteboard:error', {
                    message: 'Unauthorized access to whiteboard',
                });
                return;
            }

            // Get whiteboard data from interaction service
            const result = (await this.interactionClient.getWhiteboardData(
                data.roomId,
            )) as any;

            if (result?.success && result?.whiteboard_data) {
                // Ensure elements is properly parsed and structured
                let elements = result.whiteboard_data.elements || [];
                let state = {};

                // Parse state if it's a string
                if (result.whiteboard_data.state) {
                    try {
                        state =
                            typeof result.whiteboard_data.state === 'string'
                                ? JSON.parse(result.whiteboard_data.state)
                                : result.whiteboard_data.state;
                    } catch (e) {
                        state = {};
                    }
                }

                client.emit('whiteboard:data', {
                    roomId: data.roomId,
                    elements: elements,
                    state: state,
                    version: result.whiteboard_data.version || 0,
                    timestamp: result.whiteboard_data.updated_at || Date.now(),
                });
            } else {
                client.emit('whiteboard:error', {
                    message: 'Failed to get whiteboard data',
                });
            }
        } catch (error) {
            client.emit('whiteboard:error', {
                message: 'Internal server error',
            });
        }
    }

    async handleClearWhiteboard(client: Socket, data: { roomId: string }) {
        try {
            // Validate user is in the room
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            const roomId = await this.helperService.getRoomIdBySocketId(
                client.id,
            );

            if (!peerId || !roomId || roomId !== data.roomId) {
                client.emit('whiteboard:error', {
                    message: 'Unauthorized access to whiteboard',
                });
                return;
            }

            // Check if user has permission to clear
            const hasPermission =
                await this.interactionClient.checkUserPermission(
                    data.roomId,
                    peerId,
                );

            if (!hasPermission?.success || !hasPermission?.can_draw) {
                client.emit('whiteboard:error', {
                    message: 'No permission to clear whiteboard',
                });
                return;
            }

            // Clear whiteboard via interaction service
            const result = (await this.interactionClient.clearWhiteboard(
                data.roomId,
            )) as any;

            if (result?.success) {
                // Broadcast clear event to all clients in the room
                this.eventService.broadcastToRoom(
                    client,
                    data.roomId,
                    'whiteboard:cleared',
                    {
                        roomId: data.roomId,
                        timestamp: Date.now(),
                        clearedBy: peerId,
                    },
                );
            } else {
                client.emit('whiteboard:error', {
                    message: 'Failed to clear whiteboard',
                });
            }
        } catch (error) {
            client.emit('whiteboard:error', {
                message: 'Internal server error',
            });
        }
    }

    async handleUpdatePermissions(
        client: Socket,
        data: { roomId: string; allowed: string[] },
    ) {
        try {
            // Validate user is in the room
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            const roomId = await this.helperService.getRoomIdBySocketId(
                client.id,
            );

            if (!peerId || !roomId || roomId !== data.roomId) {
                client.emit('whiteboard:error', {
                    message: 'Unauthorized access to whiteboard',
                });
                return;
            }

            // Update permissions via interaction service
            const result = (await this.interactionClient.updatePermissions(
                data.roomId,
                data.allowed,
            )) as any;

            if (result?.success) {
                // Broadcast permissions update to all clients in the room
                this.eventService.broadcastToRoom(
                    client,
                    data.roomId,
                    'whiteboard:permissions-updated',
                    {
                        roomId: data.roomId,
                        allowed: data.allowed,
                        updatedBy: peerId,
                        timestamp: Date.now(),
                    },
                );
            } else {
                client.emit('whiteboard:error', {
                    message: 'Failed to update permissions',
                });
            }
        } catch (error) {
            client.emit('whiteboard:error', {
                message: 'Internal server error',
            });
        }
    }

    async handleGetPermissions(client: Socket, data: { roomId: string }) {
        try {
            // Validate user is in the room
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            const roomId = await this.helperService.getRoomIdBySocketId(
                client.id,
            );

            if (!peerId || !roomId || roomId !== data.roomId) {
                client.emit('whiteboard:error', {
                    message: 'Unauthorized access to whiteboard',
                });
                return;
            }

            // Get permissions from interaction service
            const result = (await this.interactionClient.getPermissions(
                data.roomId,
            )) as any;

            if (result?.success) {
                client.emit('whiteboard:permissions', {
                    roomId: data.roomId,
                    allowed: result.allowed_users || [],
                    timestamp: Date.now(),
                });
            } else {
                client.emit('whiteboard:error', {
                    message: 'Failed to get permissions',
                });
            }
        } catch (error) {
            client.emit('whiteboard:error', {
                message: 'Internal server error',
            });
        }
    }

    async handlePointerUpdate(
        client: Socket,
        data: {
            roomId: string;
            position: { x: number; y: number; tool: string };
        },
    ) {
        try {
            // Validate user is in the room
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            const roomId = await this.helperService.getRoomIdBySocketId(
                client.id,
            );

            if (!peerId || !roomId || roomId !== data.roomId) {
                return; // Silently ignore unauthorized pointer updates
            }

            // Check if user has permission to draw
            const hasPermission =
                await this.interactionClient.checkUserPermission(
                    data.roomId,
                    peerId,
                );

            if (!hasPermission?.success || !hasPermission?.can_draw) {
                return; // Silently ignore if no permission
            }

            // Update pointer position via interaction service
            await this.interactionClient.updateUserPointer(
                data.roomId,
                peerId,
                data.position,
            );

            // Broadcast pointer position to other clients in the room (excluding sender)
            this.eventService.broadcastToRoom(
                client,
                data.roomId,
                'whiteboard:pointer-update',
                {
                    roomId: data.roomId,
                    userId: peerId,
                    position: data.position,
                    timestamp: Date.now(),
                },
            );
        } catch (error) {
            console.error('[WhiteboardHandler] Error updating pointer:', error);
            // Silently ignore pointer errors to avoid spam
        }
    }

    async handlePointerLeave(client: Socket, data: { roomId: string }) {
        try {
            // Validate user is in the room
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            const roomId = await this.helperService.getRoomIdBySocketId(
                client.id,
            );

            if (!peerId || !roomId || roomId !== data.roomId) {
                return; // Silently ignore unauthorized pointer updates
            }

            // Remove pointer position via interaction service
            await this.interactionClient.removeUserPointer(data.roomId, peerId);

            // Broadcast pointer leave to other clients in the room (excluding sender)
            this.eventService.broadcastToRoom(
                client,
                data.roomId,
                'whiteboard:pointer-leave',
                {
                    roomId: data.roomId,
                    userId: peerId,
                    timestamp: Date.now(),
                },
            );
        } catch (error) {
            console.error('[WhiteboardHandler] Error removing pointer:', error);
            // Silently ignore pointer errors to avoid spam
        }
    }
}
