import {
    BadRequestException,
    Body,
    CanActivate,
    Controller,
    Delete,
    ExecutionContext,
    ForbiddenException,
    Get,
    Injectable,
    Param,
    Patch,
    Post,
    Req,
    UnauthorizedException,
    UseGuards
} from '@nestjs/common';
import * as mediasoupTypes from 'mediasoup/node/lib/types';
import { Socket } from 'socket.io';
import { AuthClientService } from './clients/auth.client';
import { RoomClientService } from './clients/room.client';
import { Participant } from './interfaces/interface';
import { HttpBroadcastService } from './services/http-broadcast.service';
import { WebSocketEventService } from './services/websocket-event.service';

// JWT Authentication Guard
@Injectable()
class JwtAuthGuard implements CanActivate {
    constructor(private readonly authClient: AuthClientService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const token = this.extractTokenFromHeader(request);
        console.log('token: ', token);

        if (!token) {
            throw new UnauthorizedException('No token provided');
        }

        try {
            // Verify token with auth service
            const result = await this.authClient.verifyToken(token);

            if (!result.success) {
                throw new UnauthorizedException('Invalid token');
            }

            // Attach user info to request
            request.user = result.user;
            return true;
        } catch (error) {
            throw new UnauthorizedException('Token validation failed');
        }
    }

    private extractTokenFromHeader(request: any): string | undefined {
        const [type, token] = request.headers.authorization?.split(' ') ?? [];
        return type === 'Bearer' ? token : undefined;
    }
}

@Controller('api/room')
export class RoomHttpController {
    constructor(
        private readonly roomClient: RoomClientService,
        private readonly authClient: AuthClientService,
        private readonly eventService: WebSocketEventService,
        private readonly broadcastService: HttpBroadcastService,
    ) {}

    @Post(':roomId/transports/:transportId/connect')
    async connectTransport(
        @Param('roomId') roomId: string,
        @Param('transportId') transportId: string,
        @Body() body: { dtlsParameters: any; peerId: string },
        @Req() req: any,
    ) {
        return {
            success: false,
            message:
                'Transport connection is now handled via WebSocket. Please use WebSocket API.',
            redirectTo: 'WebSocket sfu:connect-transport event',
        };
    }

    @Post(':roomId/produce')
    async produce(
        @Param('roomId') roomId: string,
        @Body()
        body: {
            transportId: string;
            kind: mediasoupTypes.MediaKind;
            rtpParameters: mediasoupTypes.RtpParameters;
            metadata: any;
            peerId: string;
        },
        @Req() req: any,
    ) {
        return {
            success: false,
            message:
                'Media production is now handled via WebSocket. Please use WebSocket API.',
            redirectTo: 'WebSocket sfu:produce event',
        };
    }

    @Post(':roomId/consume')
    async consume(
        @Param('roomId') roomId: string,
        @Body()
        body: {
            streamId: string;
            transportId: string;
            peerId: string;
            client: Socket; // Optional client ID for WebSocket
        },
    ) {
        return {
            success: false,
            message:
                'Media consumption is now handled via WebSocket. Please use WebSocket API.',
            redirectTo: 'WebSocket sfu:consume event',
        };
    }

    @Post(':roomId/consumers/:consumerId/resume')
    async resumeConsumer(
        @Param('roomId') roomId: string,
        @Param('consumerId') consumerId: string,
        @Body() body: { peerId: string },
        @Req() req: any,
    ) {
        return {
            success: false,
            message:
                'Consumer resume is now handled via WebSocket. Please use WebSocket API.',
            redirectTo: 'WebSocket sfu:resume-consumer event',
        };
    }

    @Delete(':roomId/streams/:streamId')
    async unpublish(
        @Param('roomId') roomId: string,
        @Param('streamId') streamId: string,
        @Body() body: { peerId: string },
        @Req() req: any,
    ) {
        return {
            success: false,
            message:
                'Stream unpublishing is now handled via WebSocket. Please use WebSocket API.',
            redirectTo: 'WebSocket sfu:unpublish event',
        };
    }

    @Patch(':roomId/streams/:streamId')
    async updateStream(
        @Param('roomId') roomId: string,
        @Param('streamId') streamId: string,
        @Body() body: { metadata: any; peerId: string },
        @Req() req: any,
    ) {
        return {
            success: false,
            message:
                'Stream updates are now handled via WebSocket. Please use WebSocket API.',
            redirectTo: 'WebSocket sfu:update-stream event',
        };
    }

    @Post(':roomId/leave')
    async leaveRoom(
        @Param('roomId') roomId: string,
        @Body() body: { peerId: string },
        @Req() req: any,
    ) {
        try {
            console.log(`[HTTP] Leave room: ${roomId}, peerId: ${body.peerId}`);

            const participant = await this.roomClient.getParticipantByPeerId(
                roomId,
                body.peerId,
            );

            if (!participant) {
                return { success: true, message: 'Already left' }; // Already left
            }

            // Use room client directly to leave room
            await this.roomClient.leaveRoom({
                roomId,
                participantId: participant.peer_id,
                socketId: participant.socket_id,
            });

            // Broadcast via WebSocket
            this.broadcastService.broadcastToRoom(roomId, 'peer-left', {
                roomId,
                peerId: participant.peer_id,
            });

            console.log(`[HTTP] Left room: ${roomId}, peerId: ${body.peerId}`);

            return {
                success: true,
                message: 'Left room successfully',
            };
        } catch (error) {
            console.error('[HTTP] Leave room error:', error);
            throw error;
        }
    }

    // Organization Room Endpoints
    @Post('org/verify')
    @UseGuards(JwtAuthGuard)
    async verifyOrgRoomAccess(
        @Body() body: { roomId: string },
        @Req() req: any,
    ) {
        try {
            const userId = req.user.id;

            // Get organization ID from user context
            const orgId = req.user.orgId;
            const userRole = req.user.role || 'member';

            if (!orgId) {
                throw new BadRequestException(
                    'User not associated with any organization. Please contact administrator.',
                );
            }

            // Verify room access using new method
            const accessResult = await this.roomClient.verifyRoomAccess({
                user_id: userId,
                room_id: body.roomId,
                org_id: orgId,
                user_role: userRole,
            });

            if (!accessResult.can_join) {
                throw new ForbiddenException(
                    accessResult.reason || 'Access denied',
                );
            }

            return {
                data: {
                    success: true,
                    message: 'Access verified',
                    roomId: body.roomId,
                },
            };
        } catch (error) {
            console.error('[HTTP] Verify org room access error:', error);
            throw error;
        }
    }

    @Post('org/join')
    @UseGuards(JwtAuthGuard)
    async joinOrgRoomByToken(
        @Body() body: { roomId: string; peerId: string },
        @Req() req: any,
    ) {
        try {
            const userId = req.user.id;

            // Get organization ID from user context
            const orgId = req.user.organizationId || req.user.orgId;
            const userRole = req.user.role || 'member';

            console.log(
                '[DEBUG] joinOrgRoomByToken - User object:',
                JSON.stringify(req.user, null, 2),
            );
            console.log('[DEBUG] joinOrgRoomByToken - orgId:', orgId);

            if (!orgId) {
                console.log(
                    '[DEBUG] joinOrgRoomByToken - No organization ID found, using default',
                );
                // Use default for development
                const defaultOrgId = 'default';

                const accessResult = await this.roomClient.verifyRoomAccess({
                    user_id: userId,
                    room_id: body.roomId,
                    org_id: defaultOrgId,
                    user_role: userRole,
                });

                if (!accessResult.can_join) {
                    throw new ForbiddenException(
                        accessResult.reason || 'Access denied',
                    );
                }

                // Continue with default orgId
                const roomId = body.roomId;

                // Create room if it doesn't exist
                let room = await this.roomClient.getRoom(roomId);
                if (!room.data?.room_id) {
                    await this.roomClient.createRoom(roomId);
                    room = await this.roomClient.getRoom(roomId);
                }

                // Add participant with organization context
                const participant: Participant = {
                    peer_id: body.peerId,
                    socket_id: `org-${body.peerId}-${Date.now()}`,
                    transports: new Map(),
                    producers: new Map(),
                    consumers: new Map(),
                    is_creator: false,
                    time_arrive: new Date(),
                    name: req.user.name || `User-${body.peerId}`,
                    isAudioEnabled: true,
                    isVideoEnabled: true,
                    isHost: false,
                    organizationId: defaultOrgId,
                };

                await this.roomClient.setParticipant(roomId, participant);

                // Broadcast to other participants
                this.broadcastService.broadcastToRoom(
                    roomId,
                    'sfu:new-peer-join',
                    {
                        roomId: roomId,
                        user: {
                            peerId: participant.peer_id,
                            isCreator: participant.is_creator,
                            timeArrive: participant.time_arrive,
                            name: participant.name,
                            organizationId: participant.organizationId,
                        },
                    },
                );

                console.log(
                    `[HTTP] User ${req.user.name} (${userId}) joined org room: ${body.roomId} (development mode)`,
                );

                return {
                    success: true,
                    message:
                        'Joined organization room successfully (development mode)',
                    roomId: roomId,
                    participant,
                    user: {
                        id: req.user.id,
                        name: req.user.name,
                        email: req.user.email,
                    },
                };
            }

            // Verify room access using new method
            const accessResult = await this.roomClient.verifyRoomAccess({
                user_id: userId,
                room_id: body.roomId,
                org_id: orgId,
                user_role: userRole,
            });

            if (!accessResult.can_join) {
                throw new ForbiddenException(
                    accessResult.reason || 'Access denied',
                );
            }

            const roomId = body.roomId;

            // Create room if it doesn't exist
            let room = await this.roomClient.getRoom(roomId);
            if (!room.data?.room_id) {
                await this.roomClient.createRoom(roomId);
                room = await this.roomClient.getRoom(roomId);
            }

            // Add participant with organization context
            const participant: Participant = {
                peer_id: body.peerId,
                socket_id: `org-${body.peerId}-${Date.now()}`,
                transports: new Map(),
                producers: new Map(),
                consumers: new Map(),
                is_creator: false, // TODO: Check if user is org room creator
                time_arrive: new Date(),
                name: req.user.name || `User-${body.peerId}`,
                isAudioEnabled: true,
                isVideoEnabled: true,
                isHost: false, // TODO: Check if user is org room creator
                organizationId: orgId,
            };

            await this.roomClient.setParticipant(roomId, participant);

            // Broadcast to other participants
            this.broadcastService.broadcastToRoom(roomId, 'sfu:new-peer-join', {
                roomId: roomId,
                user: {
                    peerId: participant.peer_id,
                    isCreator: participant.is_creator,
                    timeArrive: participant.time_arrive,
                    name: participant.name,
                    organizationId: participant.organizationId,
                },
            });

            console.log(
                `[HTTP] User ${req.user.name} (${userId}) joined org room: ${body.roomId}`,
            );

            return {
                success: true,
                message: 'Joined organization room successfully',
                roomId: roomId,
                participant,
                user: {
                    id: req.user.id,
                    name: req.user.name,
                    email: req.user.email,
                },
            };
        } catch (error) {
            console.error('[HTTP] Join org room by token error:', error);
            throw error;
        }
    }

    @Post('org/create')
    @UseGuards(JwtAuthGuard)
    async createOrgRoom(
        @Body()
        body: {
            name: string;
            description?: string;
            isPublic?: boolean;
            password?: string;
            orgId?: string;
        },
        @Req() req: any,
    ) {
        try {
            const userId = req.user.id;

            // Get organization ID from request body or user context
            const orgId = body.orgId || req.user.orgId;

            if (!orgId) {
                throw new BadRequestException('Organization ID is required');
            }

            const result = await this.roomClient.createOrgRoom({
                userId,
                orgId,
                name: body.name,
                description: body.description,
                isPublic: body.isPublic || false,
                password: body.password,
            });

            return {
                success: result.success,
                message: result.message,
                room_id: result.room_id,
                data: {
                    roomId: result.room_id,
                    success: result.success,
                },
            };
        } catch (error) {
            console.error('[HTTP] Create org room error:', error);
            throw error;
        }
    }

    @Get('org/rooms')
    @UseGuards(JwtAuthGuard)
    async getOrgRooms(@Req() req: any) {
        try {
            const userId = req.user.id;

            // Get organization ID from user context
            const orgId = req.user.orgId;

            if (!orgId) {
                throw new BadRequestException(
                    'User not associated with any organization',
                );
            }

            const rs = await this.roomClient.getOrgRooms({
                userId,
                orgId,
            });
            return {
                data: rs,
            };
        } catch (error) {
            console.error('[HTTP] Get org rooms error:', error);
            throw error;
        }
    }
}
