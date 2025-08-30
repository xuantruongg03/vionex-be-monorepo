import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { isValidRoomId } from './common/validate';
import * as I from './interface';
import { RoomService } from './room.service';

@Controller()
export class RoomGrpcController {
    constructor(private readonly roomService: RoomService) {}

    @GrpcMethod('RoomService', 'IsRoomExists')
    async isRoomExists(
        data: I.IsRoomExistsRequest,
    ): Promise<I.IsRoomExistsResponse> {
        try {
            if (!data.room_id || !isValidRoomId(data.room_id)) {
                return { is_exists: false };
            }

            const exists = this.roomService.checkRoomExists(data.room_id);
            return { is_exists: exists };
        } catch (error) {
            return { is_exists: false };
        }
    }

    @GrpcMethod('RoomService', 'CreateRoom')
    async createRoom(data: I.CreateRoomRequest): Promise<I.CreateRoomResponse> {
        try {
            const roomId = data.room_id;
            await this.roomService.createRoom(roomId);
            return {
                room_id: roomId,
                message: 'Room created successfully',
                success: true,
            };
        } catch (error) {
            return {
                room_id: '',
                message: 'Failed to create room',
                success: false,
            };
        }
    }

    @GrpcMethod('RoomService', 'JoinRoom')
    async joinRoom(data: I.JoinRoomRequest): Promise<I.JoinRoomResponse> {
        try {
            if (!data.room_id || !isValidRoomId(data.room_id)) {
                return {
                    success: false,
                    message: 'Invalid room ID',
                };
            }

            const exists = this.roomService.checkRoomExists(data.room_id);
            if (!exists) {
                return {
                    success: false,
                    message: 'Room does not exist',
                };
            }

            // Check if this is an organization room
            if (data.room_id.startsWith('org_')) {
                // For org rooms, verify access
                const verifyRequest: I.VerifyRoomAccessRequest = {
                    room_id: data.room_id,
                    user_id: data.user_id,
                    org_id: 'default', // TODO: Get from user context
                    user_role: 'member', // TODO: Get from user context
                };

                const accessResult =
                    await this.roomService.verifyRoomAccess(verifyRequest);
                if (!accessResult.can_join) {
                    return {
                        success: false,
                        message:
                            accessResult.reason ||
                            'Access denied to organization room',
                    };
                }
            }

            // Add user to room logic here if needed
            return {
                success: true,
                message: 'Successfully joined room',
            };
        } catch (error) {
            console.error(`Error joining room ${data.room_id}:`, error);
            return {
                success: false,
                message: 'Failed to join room',
            };
        }
    }

    @GrpcMethod('RoomService', 'IsUsernameAvailable')
    async isUsernameAvailable(data: {
        room_id: string;
        username: string;
    }): Promise<{ success: boolean; message?: string }> {
        try {
            if (!data.room_id || !isValidRoomId(data.room_id)) {
                return { success: false, message: 'Invalid room ID' };
            }

            if (!data.username || data.username.trim() === '') {
                return { success: false, message: 'Username cannot be empty' };
            }

            const isAvailable = this.roomService.isUsernameAvailable(
                data.room_id,
                data.username,
            );
            if (!isAvailable.success) {
                return { success: false, message: isAvailable.message };
            }

            return {
                success: isAvailable.success,
                message: isAvailable.message,
            };
        } catch (error) {
            console.error(`Error checking username availability:`, error);
            return {
                success: false,
                message: 'Error checking username availability',
            };
        }
    }

    @GrpcMethod('RoomService', 'GetRoom')
    async getRoom(data: I.GetRoomRequest): Promise<I.GetRoomResponse> {
        try {
            const room = await this.roomService.getRoom(data.room_id);
            if (!room) {
                return { data: null, success: false };
            }
            const participants = room.participants || [];

            // Serialize participants for gRPC transmission
            const serializedParticipants = participants.map((participant) => ({
                socket_id: participant.socket_id,
                peer_id: participant.peer_id,
                transports: {}, // Maps will be reconstructed on the client side
                producers: {}, // Maps will be reconstructed on the client side
                consumers: {}, // Maps will be reconstructed on the client side
                is_creator: participant.is_creator,
                time_arrive: participant.time_arrive,
                rtp_capabilities: participant.rtp_capabilities
                    ? typeof participant.rtp_capabilities === 'string'
                        ? participant.rtp_capabilities
                        : JSON.stringify(participant.rtp_capabilities)
                    : '',
                user_info: participant.user_info, // Include user_info in response
            }));

            const response = {
                data: {
                    room_id: room.room_id,
                    participants: serializedParticipants as any,
                    isLocked: room.isLocked,
                },
                success: true,
            };

            return response;
        } catch (error) {
            console.error(`Error getting room ${data.room_id}:`, error);
            return { data: null, success: false };
        }
    }

    @GrpcMethod('RoomService', 'SetParticipant')
    async setParticipant(
        data: I.SetParticipantRequest,
    ): Promise<I.SetParticipantResponse> {
        try {
            const result = await this.roomService.addParticipant(
                data.room_id,
                data.participant,
            );
            return {
                success: result !== null,
                message:
                    result !== null
                        ? 'Participant added successfully'
                        : 'Failed to add participant',
            };
        } catch (error) {
            console.error(`Error setting participant:`, error);
            return {
                success: false,
                message: 'Failed to add participant',
            };
        }
    }

    @GrpcMethod('RoomService', 'GetParticipants')
    async getParticipants(
        data: I.GetParticipantsRequest,
    ): Promise<I.GetParticipantsResponse> {
        try {
            const room = await this.roomService.getRoom(data.room_id);
            return { participants: room?.participants || [] };
        } catch (error) {
            console.error(
                `Error getting participants for room ${data.room_id}:`,
                error,
            );
            return { participants: [] };
        }
    }

    @GrpcMethod('RoomService', 'GetParticipantByPeerId')
    async getParticipantByPeerId(data: {
        peer_id: string;
        room_id: string;
    }): Promise<I.GetParticipantByPeerIdResponse> {
        try {
            const participant = this.roomService.getParticipantByPeerId(
                data.peer_id,
                data.room_id,
            );

            if (!participant) {
                return { participant: null };
            }

            // Serialize participant for gRPC transmission
            const serializedParticipant = {
                socket_id: participant.socket_id,
                peer_id: participant.peer_id,
                transports: {}, // Maps will be reconstructed on the client side
                producers: {}, // Maps will be reconstructed on the client side
                consumers: {}, // Maps will be reconstructed on the client side
                is_creator: participant.is_creator,
                time_arrive: participant.time_arrive,
                rtp_capabilities: participant.rtp_capabilities
                    ? typeof participant.rtp_capabilities === 'string'
                        ? participant.rtp_capabilities
                        : JSON.stringify(participant.rtp_capabilities)
                    : '',
                user_info: participant.user_info, // Include user_info in response
            };

            return { participant: serializedParticipant as any };
        } catch (error) {
            console.error(
                `Error getting participant by peer ID ${data.peer_id}:`,
                error,
            );
            return { participant: null };
        }
    }

    @GrpcMethod('RoomService', 'GetParticipantBySocketId')
    async getParticipantBySocketId(
        data: any,
    ): Promise<I.GetParticipantBySocketIdResponse> {
        try {
            const result = this.roomService.getParticipantBySocketId(
                data.socket_id,
            );

            if (!result) {
                return { participant: null };
            }

            // Return participant with room_id included
            const response = {
                peer_id: result.participant.peer_id,
                socket_id: result.participant.socket_id,
                is_creator: result.participant.is_creator,
                time_arrive: result.participant.time_arrive,
                room_id: result.roomId, // Include room_id in response
                rtp_capabilities: result.participant.rtp_capabilities
                    ? typeof result.participant.rtp_capabilities === 'string'
                        ? result.participant.rtp_capabilities
                        : JSON.stringify(result.participant.rtp_capabilities)
                    : '',
            };

            return { participant: response };
        } catch (error) {
            console.error(
                `Error getting participant by socket ID ${data.socket_id}:`,
                error,
            );
            return { participant: null };
        }
    }

    @GrpcMethod('RoomService', 'RemoveParticipant')
    async removeParticipant(
        data: I.RemoveParticipantRequest,
    ): Promise<I.RemoveParticipantResponse> {
        try {
            const success = await this.roomService.removeParticipant(
                data.room_id,
                data.peer_id,
            );
            return {
                success,
                message: success
                    ? 'Participant removed successfully'
                    : 'Failed to remove participant',
            };
        } catch (error) {
            console.error(`Error removing participant:`, error);
            return {
                success: false,
                message: 'Failed to remove participant',
            };
        }
    }

    @GrpcMethod('RoomService', 'SetTransport')
    async setTransport(
        data: I.SetTransportRequest,
    ): Promise<I.SetTransportResponse> {
        try {
            if (
                !data.transport_data ||
                data.transport_data === 'undefined' ||
                data.transport_data === 'null'
            ) {
                return {
                    success: false,
                    message: 'Invalid transport data provided',
                };
            }

            // Parse transport data and set it
            const transportData = JSON.parse(data.transport_data);
            const success = await this.roomService.setTransport(
                data.room_id,
                transportData,
                data.peer_id,
            );
            return {
                success,
                message: success
                    ? 'Transport set successfully'
                    : 'Failed to set transport',
            };
        } catch (error) {
            console.error(`Error setting transport:`, error);
            return {
                success: false,
                message: 'Failed to set transport',
            };
        }
    }

    @GrpcMethod('RoomService', 'SetProducer')
    async setProducer(
        data: I.SetProducerRequest,
    ): Promise<I.SetProducerResponse> {
        try {
            // Parse producer data and set it
            const producerData = JSON.parse(data.producer_data);
            const success = await this.roomService.setProducer(
                data.room_id,
                producerData,
                data.peer_id,
            );
            return {
                success,
                message: success
                    ? 'Producer set successfully'
                    : 'Failed to set producer',
            };
        } catch (error) {
            console.error(`Error setting producer:`, error);
            return {
                success: false,
                message: 'Failed to set producer',
            };
        }
    }

    @GrpcMethod('RoomService', 'GetParticipantRoom')
    async getParticipantRoom(
        data: I.GetParticipantRoomRequest,
    ): Promise<I.GetParticipantRoomResponse> {
        try {
            const roomId = await this.roomService.getParticipantRoom(
                data.peer_id,
            );
            return { room_id: roomId || '' };
        } catch (error) {
            console.error(`Error getting participant room:`, error);
            return { room_id: '' };
        }
    }

    @GrpcMethod('RoomService', 'RemoveProducerFromParticipant')
    async removeProducerFromParticipant(
        data: I.RemoveProducerFromParticipantRequest,
    ): Promise<I.RemoveProducerFromParticipantResponse> {
        try {
            const success =
                await this.roomService.removeProducerFromParticipant(
                    data.room_id,
                    data.peer_id,
                    data.producer_id,
                );
            return {
                success,
                message: success
                    ? 'Producer removed successfully'
                    : 'Failed to remove producer',
            };
        } catch (error) {
            console.error(`Error removing producer from participant:`, error);
            return {
                success: false,
                message: 'Failed to remove producer',
            };
        }
    }

    @GrpcMethod('RoomService', 'LeaveRoom')
    async leaveRoom(data: I.LeaveRoomRequest): Promise<I.LeaveRoomResponse> {
        try {
            const result = await this.roomService.leaveRoom(
                data.room_id,
                data.participant_id,
            );

            return {
                success: result.success,
                message: result.success
                    ? 'Participant left room successfully'
                    : 'Failed to leave room',
                removed_streams: [],
                new_creator: result.newCreator
                    ? result.newCreator.peer_id
                    : null,
                is_room_empty: result.isRoomEmpty,
                participant_id: data.participant_id,
            };
        } catch (error) {
            console.error(`Error leaving room:`, error);
            return {
                success: false,
                message: 'Failed to leave room',
                removed_streams: [],
                new_creator: null,
                is_room_empty: false,
                participant_id: data.participant_id,
            };
        }
    }

    @GrpcMethod('RoomService', 'UpdateParticipantRtpCapabilities')
    async updateParticipantRtpCapabilities(data: {
        peer_id: string;
        rtp_capabilities: string;
    }) {
        try {
            const rtpCapabilities = JSON.parse(data.rtp_capabilities);
            const result =
                await this.roomService.updateParticipantRtpCapabilities(
                    data.peer_id,
                    rtpCapabilities,
                );

            return {
                success: result.success,
                message: result.message || result.error,
                error: result.error,
            };
        } catch (error) {
            console.error(
                'Error updating participant RTP capabilities:',
                error,
            );
            return {
                success: false,
                message: 'Failed to update RTP capabilities',
                error: error.message,
            };
        }
    }

    @GrpcMethod('RoomService', 'LockRoom')
    async handleLockRoom(data: {
        room_id: string;
        password: string;
        creator_id: string;
    }): Promise<{ status: string; message: string }> {
        try {
            if (!data.room_id || !data.password || !data.creator_id) {
                throw new RpcException('Missing required fields for lock room');
            }

            // Verify that the creator_id is actually the creator of the room
            const room = await this.roomService.getRoom(data.room_id);
            if (!room) {
                throw new RpcException('Room not found');
            }

            // Check if the user is the creator
            const creator = room.participants.find(
                (p) => p.peer_id === data.creator_id && p.is_creator,
            );
            if (!creator) {
                throw new RpcException('Only room creator can lock the room');
            }

            const result = this.roomService.lockRoom(
                data.room_id,
                data.password,
                data.creator_id,
            );

            if (result) {
                return {
                    status: 'success',
                    message: `Room ${data.room_id} has been locked`,
                };
            } else {
                throw new RpcException('Failed to lock room');
            }
        } catch (error) {
            console.error('Error locking room:', error);
            throw new RpcException(error.message || 'Failed to lock room');
        }
    }

    @GrpcMethod('RoomService', 'UnlockRoom')
    async handleUnlockRoom(data: {
        room_id: string;
        creator_id: string;
    }): Promise<{ status: string; message: string }> {
        try {
            if (!data.room_id || !data.creator_id) {
                throw new RpcException(
                    'Missing required fields for unlock room',
                );
            }

            // Verify that the creator_id is actually the creator of the room
            const room = await this.roomService.getRoom(data.room_id);
            if (!room) {
                throw new RpcException('Room not found');
            }

            // Check if the user is the creator
            const creator = room.participants.find(
                (p) => p.peer_id === data.creator_id && p.is_creator,
            );
            if (!creator) {
                throw new RpcException('Only room creator can unlock the room');
            }

            const result = this.roomService.unlockRoom(
                data.room_id,
                data.creator_id,
            );

            if (result) {
                return {
                    status: 'success',
                    message: `Room ${data.room_id} has been unlocked`,
                };
            } else {
                throw new RpcException(
                    'Failed to unlock room or not authorized',
                );
            }
        } catch (error) {
            console.error('Error unlocking room:', error);
            throw new RpcException(error.message || 'Failed to unlock room');
        }
    }

    @GrpcMethod('RoomService', 'IsRoomLocked')
    async handleIsRoomLocked(data: {
        room_id: string;
    }): Promise<{ is_locked: boolean }> {
        try {
            const isLocked = this.roomService.isRoomLocked(data.room_id);
            return { is_locked: isLocked };
        } catch (error) {
            console.error('Error checking room lock status:', error);
            return { is_locked: false };
        }
    }

    @GrpcMethod('RoomService', 'VerifyRoomPassword')
    async handleVerifyRoomPassword(data: {
        room_id: string;
        password: string;
    }): Promise<{ is_valid: boolean }> {
        try {
            const isValid = this.roomService.verifyRoomPassword(
                data.room_id,
                data.password,
            );
            return { is_valid: isValid };
        } catch (error) {
            console.error('Error verifying room password:', error);
            return { is_valid: false };
        }
    }

    // NEW: Organization Room Methods

    @GrpcMethod('RoomService', 'CreateOrgRoom')
    async createOrgRoom(
        data: I.CreateOrgRoomRequest,
    ): Promise<I.CreateOrgRoomResponse> {
        try {
            const result = await this.roomService.createOrgRoom(data);
            return {
                success: result.success,
                message: result.message,
                room_id: result.room_id,
            };
        } catch (error) {
            console.error('Error creating organization room:', error);
            return {
                success: false,
                message: 'Failed to create organization room',
                room_id: '',
            };
        }
    }

    @GrpcMethod('RoomService', 'VerifyRoomAccess')
    async verifyRoomAccess(
        data: I.VerifyRoomAccessRequest,
    ): Promise<I.VerifyRoomAccessResponse> {
        try {
            return await this.roomService.verifyRoomAccess(data);
        } catch (error) {
            console.error('Error verifying room access:', error);
            return {
                can_join: false,
                reason: 'VERIFICATION_FAILED',
            };
        }
    }

    @GrpcMethod('RoomService', 'GetOrgRooms')
    async getOrgRooms(
        data: I.GetOrgRoomsRequest,
    ): Promise<I.GetOrgRoomsResponse> {
        try {
            // Get org_id from request or use 'default'
            const orgId = (data as any).org_id || 'default';

            const rooms = this.roomService.getOrgRooms(data.user_id, orgId);

            // Map rooms to proto format
            const mappedRooms = rooms.map((room) => ({
                id: room.room_id, // Map room_id to id
                name: room.room_id, // Use room_id as name for now
                description: room.type || 'Organization room',
                is_public: room.type === 'public',
                organization_id: room.org_id || 'default',
                created_at: room.created_at.toISOString(),
                updated_at: room.created_at.toISOString(),
                invited_users: room.invited_users || [],
                host_id: room.host_id,
                participants: Array.from(room.participants.values()),
                room_id: room.room_id, // Include room_id
                type: room.type, // Include type
            }));

            return {
                success: true,
                message: 'Organization rooms retrieved successfully',
                rooms: mappedRooms as any,
            };
        } catch (error) {
            console.error('Error getting organization rooms:', error);
            return {
                success: false,
                message: 'Failed to get organization rooms',
                rooms: [],
            };
        }
    }

    // NOTE: VerifyOrgRoomSession method removed - org room access now handled by VerifyRoomAccess
    // Users should call VerifyRoomAccess with org room ID instead
}
