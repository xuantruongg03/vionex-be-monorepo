import {
    Body,
    Controller,
    Get,
    Headers,
    HttpException,
    HttpStatus,
    Param,
    Post,
} from '@nestjs/common';
import { RoomClientService } from './clients/room.client';

@Controller()
export class GatewayController {
    // This controller can be used to define REST endpoints if needed.
    // Currently, it is empty as the WebSocket functionality is handled in GatewayGateway.
    constructor(private readonly roomClient: RoomClientService) {}

    @Get('health')
    getHealth() {
        return {
            status: 'Gateway API is working!',
            timestamp: new Date().toISOString(),
        };
    }

    @Post('validate-username')
    async validateUsername(@Body() data: { roomId: string; username: string }) {
        const { roomId, username } = data;
        if (!username || username.trim().length === 0) {
            throw new HttpException(
                'Username cannot be empty',
                HttpStatus.BAD_REQUEST,
            );
        }

        try {
            const response = await this.roomClient.isUsernameAvailable(
                roomId,
                username,
            );

            return { data: response };
        } catch (error) {
            console.error('Error validating username:', error);
            throw new HttpException(
                'Error validating username',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Post('verify-room-password')
    async verifyRoomPassword(
        @Body() data: { roomId: string; password: string },
    ) {
        const { roomId, password } = data;
        if (!roomId) {
            throw new HttpException('Missing roomId', HttpStatus.BAD_REQUEST);
        }

        try {
            // Check if room is locked
            const isLocked = await this.roomClient.isRoomLocked(roomId);

            if (!isLocked) {
                return {
                    data: {
                        success: true,
                        locked: false,
                        message: 'Room is not locked',
                    },
                };
            }

            // If room is locked, password is required
            if (!password) {
                throw new HttpException(
                    'Password required for this room',
                    HttpStatus.FORBIDDEN,
                );
            }

            // // Verify the password
            const isValid = await this.roomClient.verifyRoomPassword(
                roomId,
                password,
            );

            if (isValid) {
                return {
                    data: {
                        success: true,
                        locked: true,
                        valid: true,
                        message: 'Password valid',
                    },
                };
            } else {
                throw new HttpException(
                    'Invalid password',
                    HttpStatus.FORBIDDEN,
                );
            }
        } catch (error) {
            console.error('Error verifying room password:', error);
            throw new HttpException(
                'Error verifying room password',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Post('check-room-status')
    async checkRoomStatus(@Body() data: { roomId: string }) {
        const { roomId } = data;
        if (!roomId) {
            throw new HttpException('Missing roomId', HttpStatus.BAD_REQUEST);
        }

        //Check if room is not existing
        try {
            const room = await this.roomClient.getRoom(roomId);
            if (!room.data || !room.data.room_id) {
                throw new HttpException(
                    'Room does not exist',
                    HttpStatus.NOT_FOUND,
                );
            }
            // Check if room is locked
            const isLocked = await this.roomClient.isRoomLocked(roomId);

            return {
                data: {
                    success: true,
                    locked: isLocked,
                    message: isLocked
                        ? 'Room is password-protected'
                        : 'Room is open',
                },
            };
        } catch (error) {
            console.error('Error checking room status: ', error);
            throw new HttpException(
                'Error checking room status',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // HTTP endpoint for getting users in room
    @Get('sfu/rooms/:roomId/users')
    async getUsersInRoom(
        @Param('roomId') roomId: string,
    ) {
        try {
            const room = await this.roomClient.getRoom(roomId);
            if (!room || !room.data || !room.data.participants) {
                return { users: [] };
            }

            const users = room.data.participants.map((participant: any) => ({
                peerId: participant.peer_id || participant.peerId,
                isCreator: participant.is_creator || participant.isCreator,
                timeArrive: participant.time_arrive || participant.timeArrive,
            }));

            return {
                success: true,
                users,
            };
        } catch (error) {
            console.error('Error getting users:', error);
            throw new HttpException(
                error.message || 'Failed to get users',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
}
