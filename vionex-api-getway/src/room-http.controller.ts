import {
    BadRequestException,
    Body,
    CanActivate,
    Controller,
    ExecutionContext,
    ForbiddenException,
    Get,
    Injectable,
    Param,
    Post,
    Req,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthClientService } from './clients/auth.client';
import { RoomClientService } from './clients/room.client';
import { SfuClientService } from './clients/sfu.client';
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
        private readonly sfuClient: SfuClientService,
    ) {}

    @Post(':roomId/join')
    async joinRoom(
        @Param('roomId') roomId: string,
        @Body() body: { peerId: string; password?: string; userInfo?: any },
        @Req() req: any,
    ) {
        try {
            console.log(`[HTTP] Join room: ${roomId}, peerId: ${body.peerId}`);

            // Check if room is password protected
            const isRoomLocked = await this.roomClient.isRoomLocked(roomId);
            if (isRoomLocked) {
                if (!body.password) {
                    throw new BadRequestException(
                        'Password required for this room',
                    );
                }

                const isValid = await this.roomClient.verifyRoomPassword(
                    roomId,
                    body.password,
                );
                if (!isValid) {
                    throw new BadRequestException('Invalid room password');
                }
            }

            // Initialize room if needed
            let room = await this.roomClient.getRoom(roomId);
            if (!room.data || !room.data.room_id) {
                await this.roomClient.createRoom(roomId);
                room = await this.roomClient.getRoom(roomId);
            }

            // Check if participant already exists
            const existingParticipant =
                await this.roomClient.getParticipantByPeerId(
                    roomId,
                    body.peerId,
                );

            if (existingParticipant) {
                console.log(
                    `[HTTP] Participant ${body.peerId} already in room ${roomId}`,
                );
                return {
                    success: true,
                    message: 'Already in room',
                    participant: existingParticipant,
                    roomData: room.data,
                };
            }

            // Create participant
            const participant: Participant = {
                peer_id: body.peerId,
                socket_id: `http-${body.peerId}-${Date.now()}`, // Temporary socket ID
                transports: new Map(),
                producers: new Map(),
                consumers: new Map(),
                is_creator: false,
                time_arrive: new Date(),
                name: body.userInfo?.name || body.peerId,
                isAudioEnabled: true,
                isVideoEnabled: true,
                isHost: false,
                user_info: body.userInfo,
            };

            // Add participant to room
            await this.roomClient.setParticipant(roomId, participant);

            // Get updated room data
            const updatedRoom = await this.roomClient.getRoom(roomId);

            console.log(
                `[HTTP] Successfully joined room: ${roomId}, peerId: ${body.peerId}`,
            );

            return {
                success: true,
                message: 'Joined room successfully',
                participant,
                roomData: updatedRoom.data,
                roomId,
            };
        } catch (error) {
            console.error('[HTTP] Join room error:', error);
            throw error;
        }
    }

    @Post(':roomId/connect-websocket')
    async connectWebSocket(
        @Param('roomId') roomId: string,
        @Body() body: { peerId: string; socketId: string },
        @Req() req: any,
    ) {
        try {
            console.log(
                `[HTTP] Connect WebSocket: ${roomId}, peerId: ${body.peerId}, socketId: ${body.socketId}`,
            );

            // Get participant
            const participant = await this.roomClient.getParticipantByPeerId(
                roomId,
                body.peerId,
            );

            if (!participant) {
                throw new BadRequestException(
                    'Participant not found. Please join room first via HTTP.',
                );
            }

            // Update participant with real socket ID
            participant.socket_id = body.socketId;
            await this.roomClient.setParticipant(roomId, participant);

            // Broadcast to other participants that user is now connected via WebSocket
            this.broadcastService.broadcastToRoom(
                roomId,
                'sfu:peer-websocket-connected',
                {
                    roomId,
                    peerId: body.peerId,
                    socketId: body.socketId,
                },
            );

            console.log(
                `[HTTP] WebSocket connected for ${body.peerId} in room ${roomId}`,
            );

            return {
                success: true,
                message: 'WebSocket connected successfully',
                participant,
            };
        } catch (error) {
            console.error('[HTTP] Connect WebSocket error:', error);
            throw error;
        }
    }

    @Post(':roomId/setup-media')
    async setupMedia(
        @Param('roomId') roomId: string,
        @Body() body: { peerId: string },
        @Req() req: any,
    ) {
        try {
            console.log(
                `[HTTP] Setup media: ${roomId}, peerId: ${body.peerId}`,
            );

            // Get participant
            const participant = await this.roomClient.getParticipantByPeerId(
                roomId,
                body.peerId,
            );

            if (!participant) {
                throw new BadRequestException('Participant not found');
            }

            // Create media room in SFU service if needed
            // This ensures media room is ready before any WebRTC operations
            try {
                const mediaRoomResult =
                    await this.sfuClient.createMediaRoom(roomId);
                console.log(`[HTTP] Media room created/exists for ${roomId}`);

                // Parse the result if it's a string
                let mediaRoom;
                if (typeof mediaRoomResult === 'string') {
                    mediaRoom = JSON.parse(mediaRoomResult);
                } else {
                    mediaRoom = mediaRoomResult;
                }

                return {
                    success: true,
                    message: 'Media setup completed',
                    routerRtpCapabilities:
                        mediaRoom?.router?.rtpCapabilities ||
                        mediaRoom?.rtpCapabilities,
                };
            } catch (error) {
                console.error(
                    `[HTTP] Failed to setup media room: ${error.message}`,
                );
                throw new BadRequestException('Failed to setup media room');
            }
        } catch (error) {
            console.error('[HTTP] Setup media error:', error);
            throw error;
        }
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
