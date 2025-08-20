import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { Participant, RoomGrpcService } from '../interfaces/interface';

@Injectable()
export class RoomClientService implements OnModuleInit {
    private roomService: RoomGrpcService;

    constructor(@Inject('ROOM_SERVICE') private client: ClientGrpc) {}

    onModuleInit() {
        this.roomService =
            this.client.getService<RoomGrpcService>('RoomService');
    }

    async isRoomExists(roomId: string): Promise<boolean> {
        try {
            const response = await firstValueFrom(
                this.roomService.isRoomExists({ room_id: roomId }),
            );
            return response.is_exists;
        } catch (error) {
            console.log(`Room with ID ${roomId} does not exist:`, error);
            throw new Error(`Room with ID ${roomId} does not exist`);
        }
    }

    async lockRoom(roomId: string, password: string, creatorId: string) {
        return firstValueFrom(
            this.roomService.lockRoom({
                room_id: roomId,
                password: password,
                creator_id: creatorId,
            }),
        );
    }

    async unlockRoom(roomId: string, creatorId: string) {
        return firstValueFrom(
            this.roomService.unlockRoom({
                room_id: roomId,
                creator_id: creatorId,
            }),
        );
    }

    async isRoomLocked(roomId: string) {
        const result = await firstValueFrom(
            this.roomService.isRoomLocked({
                room_id: roomId,
            }),
        );
        return (result as { is_locked: boolean }).is_locked;
    }

    async verifyRoomPassword(roomId: string, password: string) {
        const result = await firstValueFrom(
            this.roomService.verifyRoomPassword({
                room_id: roomId,
                password: password,
            }),
        );
        return (result as { is_valid: boolean }).is_valid;
    }

    async isUsernameAvailable(
        roomId: string,
        username: string,
    ): Promise<{ success: boolean; message?: string }> {
        return firstValueFrom(
            this.roomService.isUsernameAvailable({
                room_id: roomId,
                username,
            }),
        );
    }

    async createRoom(roomId: string) {
        try {
            const response = await firstValueFrom(
                this.roomService.createRoom({ room_id: roomId }),
            );
            return { data: { roomId: response.room_id } };
        } catch (error) {
            console.error(`Error creating room:`, error);
            throw new Error(`Failed to create room`);
        }
    }

    async joinRoom(roomId: string, userId: string) {
        const response = await firstValueFrom(
            this.roomService.joinRoom({ room_id: roomId, user_id: userId }),
        );
        return response;
    }

    async getRoom(roomId: string) {
        try {
            const response = await firstValueFrom(
                this.roomService.getRoom({ room_id: roomId }),
            );

            // Ensure participants field always exists
            if (response.data && !response.data.participants) {
                response.data.participants = [];
            }

            return response;
        } catch (error) {
            throw new Error(`Room with ID ${roomId} not found`);
        }
    }
    async setParticipant(roomId: string, participant: Participant) {
        try {
            await firstValueFrom(
                this.roomService.setParticipant({
                    room_id: roomId,
                    participant: {
                        socket_id: participant.socket_id,
                        peer_id: participant.peer_id,
                        transports: {},
                        producers: {},
                        consumers: {},
                        is_creator: participant.is_creator,
                        time_arrive: participant.time_arrive.getTime(),
                        rtp_capabilities: participant.rtp_capabilities
                            ? typeof participant.rtp_capabilities === 'string'
                                ? participant.rtp_capabilities
                                : JSON.stringify(participant.rtp_capabilities)
                            : '',
                    },
                }),
            );
        } catch (error) {
            throw new Error(`Failed to set participant for room ${roomId}`);
        }
    }

    async getParticipants(roomId: string) {
        try {
            const response: any = await firstValueFrom(
                this.roomService.getParticipants({ room_id: roomId }),
            );
            if (!response || !response.participants) {
                console.warn(`No participants found for room ${roomId}`);
                return [];
            }

            return response?.participants.map((p: any) => ({
                socket_id: p.socket_id || p.socketId,
                peer_id: p.peer_id || p.peerId,
                transports: new Map(),
                producers: new Map(),
                consumers: new Map(),
                is_creator:
                    p.is_creator !== undefined ? p.is_creator : p.isCreator,
                time_arrive: new Date(p.time_arrive || p.timeArrive),
                rtp_capabilities: this.safeParseRtpCapabilities(
                    p.rtp_capabilities || p.rtpCapabilities,
                ),
            }));
        } catch (error) {
            console.error(
                `Error getting participants for room ${roomId}:`,
                error,
            );
            throw new Error(`Failed to get participants for room ${roomId}`);
        }
    }

    async getParticipantByPeerId(roomId: string, peerId: string) {
        try {
            const response: any = await firstValueFrom(
                this.roomService.getParticipantByPeerId({
                    room_id: roomId,
                    peer_id: peerId,
                }),
            );

            if (!response || !response.participant) {
                return null;
            }

            // Convert the participant data to the expected format
            const participant = response.participant;
            return {
                socket_id: participant.socket_id,
                peer_id: participant.peer_id,
                transports: new Map(),
                producers: new Map(),
                consumers: new Map(),
                is_creator: participant.is_creator,
                time_arrive: new Date(participant.time_arrive),
                rtp_capabilities: this.safeParseRtpCapabilities(
                    participant.rtp_capabilities,
                ),
            };
        } catch (error) {
            console.error(
                `Error getting participant ${peerId} from room ${roomId}:`,
                error,
            );
            return null;
        }
    }

    async removeParticipant(roomId: string, peerId: string) {
        try {
            await firstValueFrom(
                this.roomService.removeParticipant({
                    room_id: roomId,
                    peer_id: peerId,
                }),
            );
        } catch (error) {
            console.error(
                `Error removing participant ${peerId} from room ${roomId}:`,
                error,
            );
            throw new Error(
                `Failed to remove participant ${peerId} from room ${roomId}`,
            );
        }
    }

    async setTransport(roomId: string, transport: any, peerId: string) {
        try {
            if (!transport) {
                console.error('Transport is undefined or null');
                throw new Error('Transport data is required');
            }

            await firstValueFrom(
                this.roomService.setTransport({
                    room_id: roomId,
                    transport_data: JSON.stringify(transport), // Fixed field name
                    peer_id: peerId,
                }),
            );
        } catch (error) {
            console.error(`Error setting transport for room ${roomId}:`, error);
            throw new Error(`Failed to set transport for room ${roomId}`);
        }
    }

    async setProducer(roomId: string, producer: any, peerId: string) {
        try {
            await firstValueFrom(
                this.roomService.setProducer({
                    room_id: roomId,
                    producer: JSON.stringify(producer),
                    peer_id: peerId,
                }),
            );
        } catch (error) {
            console.error(`Error setting producer for room ${roomId}:`, error);
            throw new Error(`Failed to set producer for room ${roomId}`);
        }
    }

    async getParticipantRoom(peerId: string): Promise<string | null> {
        try {
            const response = await firstValueFrom(
                this.roomService.getParticipantRoom({ peer_id: peerId }),
            );
            return response.room_id || null;
        } catch (error) {
            console.error(
                `Error getting room for participant ${peerId}:`,
                error,
            );
            return null;
        }
    }

    async removeProducerFromParticipant(
        roomId: string,
        peerId: string,
        producerId: string,
    ) {
        try {
            const response = await firstValueFrom(
                this.roomService.removeProducerFromParticipant({
                    room_id: roomId,
                    peer_id: peerId,
                    producer_id: producerId,
                }),
            );
            return response;
        } catch (error) {
            console.error('Error removing producer from participant:', error);
            throw new Error('Failed to remove producer from participant');
        }
    }

    // Find participant by socket ID across all rooms (for disconnect handling)
    async findParticipantBySocketId(
        socketId: string,
    ): Promise<{ peerId: string; roomId: string } | null> {
        try {

            const response = await firstValueFrom(
                this.roomService.getParticipantBySocketId({
                    socket_id: socketId,
                }),
            );

            if (response && response.participant) {
                const participant = response.participant;

                return {
                    peerId: participant.peer_id,
                    roomId: participant.room_id,
                };
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async updateParticipantRtpCapabilities(
        peerId: string,
        rtpCapabilities: any,
    ) {
        try {
            const response = await firstValueFrom(
                this.roomService.updateParticipantRtpCapabilities({
                    peer_id: peerId,
                    rtp_capabilities: JSON.stringify(rtpCapabilities),
                }),
            );
            return response;
        } catch (error) {
            console.error(
                'Error updating participant RTP capabilities:',
                error,
            );
            return {
                success: false,
                error: 'Failed to update RTP capabilities',
            };
        }
    }

    async leaveRoom(data: {
        roomId: string;
        participantId: string;
        socketId: string;
    }) {
        try {
            const response = await firstValueFrom(
                this.roomService.leaveRoom({
                    room_id: data.roomId,
                    participant_id: data.participantId,
                    socket_id: data.socketId,
                }),
            );
            return {
                success: true,
                data: {
                    newCreator: response.new_creator_data
                        ? JSON.parse(response.new_creator_data)
                        : null,
                    isRoomEmpty: response.is_room_empty || false,
                },
            };
        } catch (error) {
            console.error('Error leaving room:', error);
            throw new Error('Failed to leave room');
        }
    }

    private safeParseRtpCapabilities(data: any): any {
        if (!data) return undefined;

        // If it's already an object (but not a string representation), return it as is
        if (typeof data === 'object' && data !== null) {
            // Check if it's already a proper RTP capabilities object
            if (data.codecs || data.headerExtensions) {
                // console.log('Returning valid RTP capabilities object');
                return data;
            }
            // If it's a generic object that was incorrectly passed, return undefined
            console.warn(
                'RTP capabilities object does not have expected structure:',
                data,
            );
            return undefined;
        }

        // If it's a string, try to parse it
        if (typeof data === 'string') {
            if (
                data === '' ||
                data === 'undefined' ||
                data === 'null' ||
                data === '[object Object]'
            ) {
                // console.log('Skipping invalid string data:', data);
                return undefined;
            }

            try {
                const parsed = JSON.parse(data);
                // console.log('Successfully parsed RTP capabilities from string');
                return parsed;
            } catch (error) {
                console.warn(
                    'Failed to parse RTP capabilities string:',
                    error,
                    'Data:',
                    data,
                );
                return undefined;
            }
        }

        // console.log('Unknown data type, returning undefined');
        return undefined;
    }

    // Organization Room Methods
    async createOrgRoom(data: {
        userId: string;
        orgId: string;
        name: string;
        description?: string;
        isPublic?: boolean;
        password?: string;
    }) {
        return firstValueFrom(
            this.roomService.createOrgRoom({
                user_id: data.userId,
                org_id: data.orgId,
                name: data.name,
                description: data.description || '',
                is_public: data.isPublic || false,
                password: data.password || '',
            }),
        ) as Promise<{
            success: boolean;
            message: string;
            room_id?: string;
        }>;
    }

    async getOrgRooms(data: { userId: string; orgId: string }) {
        const result = await firstValueFrom(
            this.roomService.getOrgRooms({
                user_id: data.userId,
                org_id: data.orgId,
            }),
        );

        return result;
    }

    async verifyRoomAccess(data: {
        user_id: string;
        room_id: string;
        org_id?: string;
        user_role?: string;
    }) {
        return firstValueFrom(
            this.roomService.verifyRoomAccess({
                user_id: data.user_id,
                room_id: data.room_id,
                org_id: data.org_id,
                user_role: data.user_role,
            }),
        ) as Promise<{
            can_join: boolean;
            reason?: string;
        }>;
    }
}
