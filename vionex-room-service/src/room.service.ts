import { Injectable } from '@nestjs/common';
import {
    Participant,
    RoomPassword,
    OrganizationRoom,
    CreateOrgRoomRequest,
    VerifyRoomAccessRequest,
    VerifyRoomAccessResponse,
} from './interface';

@Injectable()
export class RoomService {
    private rooms = new Map<string, Map<string, Participant>>();
    private roomPasswords = new Map<string, RoomPassword>();
    private orgRooms = new Map<string, OrganizationRoom>(); // NEW: Organization rooms
    private orgAccess = new Map<string, any[]>(); // NEW: Organization access cache

    /**
     * Checks if a room exists by its ID.
     * @param roomId - The ID of the room to check.
     * @returns An object indicating whether the room exists and its details if it does.
     */
    checkRoomExists(roomId: string) {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        return true;
    }

    /**
     * Checks if a username is available in the specified room.
     * @param roomId - The ID of the room.
     * @param username - The username to check.
     * @returns True if the username is available, false otherwise.
     */
    isUsernameAvailable(
        roomId: string,
        username: string,
    ): {
        success: boolean;
        message: string;
        available: boolean;
    } {
        const room = this.rooms.get(roomId);
        if (!room)
            return {
                success: false,
                message: 'Room does not exist',
                available: false,
            };

        for (const participant of room.values()) {
            if (participant.peer_id === username) {
                return {
                    success: false,
                    message: 'Username is already taken',
                    available: false,
                };
            }
        }
        return {
            success: true,
            message: 'Username is available',
            available: true,
        };
    }

    /**
     * Creates a new room with the specified ID and user ID.
     * @param userId - The ID of the user creating the room.
     * @param password - Optional password for the room.
     * @returns An object indicating the success of the operation and whether the user is the creator.
     */
    async createRoom(roomId: string) {
        this.rooms.set(roomId, new Map());
        return roomId;
    }

    /**
     * NEW: Enhanced room creation with organization support
     * @param request - Organization room creation request
     * @returns Room ID
     */
    async createOrgRoom(request: CreateOrgRoomRequest): Promise<{
        success: boolean;
        message: string;
        room_id: string;
    }> {
        try {
            // Generate unique room ID with nanoid (will use crypto.randomUUID() for now)
            const randomId =
                Math.random().toString(36).substring(2, 15) +
                Math.random().toString(36).substring(2, 15);
            const roomId = `org_${randomId}`;

            // Create regular room structure
            this.rooms.set(roomId, new Map());

            // Create organization room metadata
            const orgRoom: OrganizationRoom = {
                room_id: roomId,
                type: request.is_public ? 'public' : 'organization',
                org_id: request.org_id, // Use org_id from request
                access_level: 'org_only' as any,
                invited_users: [],
                host_id: request.user_id,
                created_at: new Date(),
                participants: this.rooms.get(roomId)!,
                password: request.password,
            };

            this.orgRooms.set(roomId, orgRoom);

            // Set password for public rooms
            if (request.is_public && request.password) {
                this.roomPasswords.set(roomId, {
                    password: request.password,
                    creator_id: request.user_id,
                });
            }

            return {
                success: true,
                message: 'Organization room created successfully',
                room_id: roomId,
            };
        } catch (error) {
            console.error('Error creating org room:', error);
            throw error;
        }
    }

    /**
     * NEW: Organization access verification
     * @param request - Access verification request
     * @returns Access verification response
     */
    async verifyRoomAccess(
        request: VerifyRoomAccessRequest,
    ): Promise<VerifyRoomAccessResponse> {
        try {
            const orgRoom = this.orgRooms.get(request.room_id);

            if (!orgRoom) {
                // Fallback to existing public room logic
                const exists = this.checkRoomExists(request.room_id);
                return { can_join: exists };
            }

            // Public room - anyone can join with password
            if (orgRoom.type === 'public') {
                return { can_join: true };
            }

            // Organization room - check membership
            if (orgRoom.type === 'organization') {
                if (!request.org_id || !request.user_role) {
                    return { can_join: false, reason: 'NOT_AUTHENTICATED' };
                }

                if (request.org_id !== orgRoom.org_id) {
                    return { can_join: false, reason: 'NOT_ORG_MEMBER' };
                }

                // Check access level
                switch (orgRoom.access_level) {
                    case 'admin_only':
                        if (!['owner'].includes(request.user_role)) {
                            return {
                                can_join: false,
                                reason: 'INSUFFICIENT_PERMISSIONS',
                            };
                        }
                        break;

                    case 'invite_only':
                        if (!orgRoom.invited_users?.includes(request.user_id)) {
                            return { can_join: false, reason: 'NOT_INVITED' };
                        }
                        break;

                    case 'org_only':
                    default:
                        // Any org member can join
                        break;
                }

                return { can_join: true };
            }

            return { can_join: false, reason: 'UNKNOWN_ROOM_TYPE' };
        } catch (error) {
            console.error('Error verifying room access:', error);
            return { can_join: false, reason: 'VERIFICATION_FAILED' };
        }
    }

    /**
     * NEW: Get organization rooms
     * @param userId - User ID
     * @param orgId - Organization ID (optional)
     * @returns List of organization rooms
     */
    getOrgRooms(userId: string, orgId?: string): OrganizationRoom[] {
        // Filter by organization ID if provided
        return Array.from(this.orgRooms.values())
            .filter((room) => {
                // Only return rooms that still exist in the main rooms map
                const roomExists = this.rooms.has(room.room_id);
                if (!roomExists) {
                    // Clean up orphaned org room metadata
                    this.orgRooms.delete(room.room_id);
                    this.roomPasswords.delete(room.room_id);
                    return false;
                }

                // Filter by organization ID if provided
                if (orgId && room.org_id !== orgId) {
                    return false;
                }

                return true;
            })
            .map((room) => {
                // Return room data
                return {
                    ...room,
                };
            });
    }

    /**
     * NEW: Clean up organization room when deleted
     * @param roomId - Room ID to remove
     */
    async removeOrgRoom(roomId: string): Promise<boolean> {
        try {
            this.orgRooms.delete(roomId);
            this.rooms.delete(roomId);
            this.roomPasswords.delete(roomId);
            return true;
        } catch (error) {
            console.error('Error removing org room:', error);
            return false;
        }
    }

    /**
     * Sets a participant in the specified room.
     * @param roomId - The ID of the room.
     * @param peerId - The ID of the participant.
     * @param participant - The participant object to set.
     * @returns An object indicating the success of the operation.
     */ async getRoom(roomId: string) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return null;
        }

        return {
            room_id: roomId,
            participants: Array.from(room.values()) || [],
            isLocked: this.roomPasswords.has(roomId),
        };
    }

    /**
     * Adds a participant to the specified room.
     * @param roomId - The ID of the room.
     * @param participant - The participant object to add.
     * @returns An object indicating the success of the operation.
     */
    async addParticipant(roomId: string, participant: Participant) {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        // Ensure Maps are initialized for the participant
        if (!participant.transports) {
            participant.transports = new Map();
        }
        if (!participant.producers) {
            participant.producers = new Map();
        }
        if (!participant.consumers) {
            participant.consumers = new Map();
        }

        // Handle RTP capabilities properly - store as the actual object, not string
        if (
            participant.rtp_capabilities &&
            typeof participant.rtp_capabilities === 'string'
        ) {
            try {
                // Skip invalid string values
                if (
                    participant.rtp_capabilities === '' ||
                    participant.rtp_capabilities === '[object Object]' ||
                    participant.rtp_capabilities === 'undefined' ||
                    participant.rtp_capabilities === 'null'
                ) {
                    participant.rtp_capabilities = undefined;
                } else {
                    participant.rtp_capabilities = JSON.parse(
                        participant.rtp_capabilities,
                    );
                }
            } catch (error) {
                console.warn(
                    'Failed to parse RTP capabilities, setting to undefined:',
                    error,
                );
                participant.rtp_capabilities = undefined;
            }
        }

        // Ensure time_arrive is a Date object
        if (typeof participant.time_arrive === 'number') {
            participant.time_arrive = new Date(participant.time_arrive);
        } else if (!participant.time_arrive) {
            participant.time_arrive = new Date();
        }

        // Check if participant already exists (for socket_id updates)
        const existingParticipant = room.get(participant.peer_id);
        if (existingParticipant) {
            // Update existing participant with new data (especially socket_id)
            existingParticipant.socket_id = participant.socket_id;
            existingParticipant.is_creator = participant.is_creator;

            // Update user_info if provided
            if (participant.user_info) {
                existingParticipant.user_info = participant.user_info;
            }

            // Keep existing Maps if they exist, otherwise use new ones
            if (!existingParticipant.transports)
                existingParticipant.transports = participant.transports;
            if (!existingParticipant.producers)
                existingParticipant.producers = participant.producers;
            if (!existingParticipant.consumers)
                existingParticipant.consumers = participant.consumers;

            // Update RTP capabilities if provided
            if (participant.rtp_capabilities) {
                existingParticipant.rtp_capabilities =
                    participant.rtp_capabilities;
            }
        } else {
            room.set(participant.peer_id, participant);
        }

        return {
            status: 'success',
            message: 'Participant added successfully',
        };
    }

    /**
     * Removes a participant from the specified room.
     * @param roomId - The ID of the room.
     * @param peerId - The ID of the participant to remove.
     * @returns An object indicating the success of the operation.
     */
    getParticipantByPeerId(peerId: string, roomId: string): Participant | null {
        const room = this.rooms.get(roomId);
        if (!room) return null;
        return room.get(peerId) || null;
    }

    getParticipantBySocketId(
        socketId: string,
    ): { participant: Participant; roomId: string } | null {
        for (const [roomId, room] of this.rooms) {
            for (const [peerId, participant] of room) {
                if (participant.socket_id === socketId) {
                    return { participant, roomId };
                }
            }
        }
        return null;
    }

    async removeParticipant(roomId: string, peerId: string) {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        if (room.has(peerId)) {
            room.delete(peerId);
            return true;
        }
        return false;
    }
    async setTransport(roomId: string, transport: any, peerId: string) {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        const participant = room.get(peerId);
        if (!participant) return false;

        // Ensure transports Map is initialized
        if (!participant.transports) {
            participant.transports = new Map();
        }

        participant.transports.set(transport.id, transport);
        return true;
    }
    async setProducer(roomId: string, producer: any, peerId: string) {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        const participant = room.get(peerId);
        if (!participant) return false;

        // Ensure producers Map is initialized
        if (!participant.producers) {
            participant.producers = new Map();
        }

        participant.producers.set(producer.id, producer);
        return true;
    }

    async getParticipantRoom(peerId: string): Promise<string | null> {
        for (const [roomId, room] of this.rooms) {
            if (room.has(peerId)) {
                return roomId;
            }
        }
        return null;
    }

    async removeProducerFromParticipant(
        roomId: string,
        peerId: string,
        producerId: string,
    ): Promise<boolean> {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        const participant = room.get(peerId);
        if (!participant) return false;

        if (participant.producers.has(producerId)) {
            participant.producers.delete(producerId);
            return true;
        }
        return false;
    }

    async leaveRoom(
        roomId: string,
        peerId: string,
    ): Promise<{
        success: boolean;
        newCreator?: Participant;
        isRoomEmpty: boolean;
        removedParticipant?: Participant;
    }> {
        const room = this.rooms.get(roomId);
        if (!room) {
            return {
                success: false,
                isRoomEmpty: true,
            };
        }

        const participant = room.get(peerId);
        if (!participant) {
            return {
                success: false,
                isRoomEmpty: room.size === 0,
            };
        }

        const wasCreator = participant.is_creator;

        // Close all transports for this participant
        for (const transport of participant.transports.values()) {
            transport.close();
        }

        // Remove participant from room
        room.delete(peerId);
        let newCreator: Participant | undefined = undefined;
        const isRoomEmpty = room.size === 0;

        // Handle creator change if the leaving participant was creator and room is not empty
        if (wasCreator && !isRoomEmpty) {
            // Find participant with earliest timeArrive (longest in room)
            const participants = Array.from(room.values());
            const longestUser = participants.reduce((max, current) => {
                return new Date(current.time_arrive) < new Date(max.time_arrive)
                    ? current
                    : max;
            });

            if (longestUser) {
                longestUser.is_creator = true;
                newCreator = longestUser;
            }
        }

        // If room is empty, clean up
        if (isRoomEmpty) {
            this.rooms.delete(roomId);

            // Clean up organization room metadata if it exists
            if (this.orgRooms.has(roomId)) {
                this.orgRooms.delete(roomId);
            }

            // Clean up room password if it exists
            if (this.roomPasswords.has(roomId)) {
                this.roomPasswords.delete(roomId);
            }
        }
        return {
            success: true,
            newCreator,
            isRoomEmpty,
            removedParticipant: participant,
        };
    }

    /**
     * Updates participant RTP capabilities
     * @param peerId - The ID of the participant
     * @param rtpCapabilities - The RTP capabilities to set
     * @returns An object indicating the success of the operation
     */
    async updateParticipantRtpCapabilities(
        peerId: string,
        rtpCapabilities: any,
    ) {
        try {
            // Find the participant across all rooms
            for (const [roomId, room] of this.rooms.entries()) {
                const participant = room.get(peerId);
                if (participant) {
                    // Update the participant's RTP capabilities - store as object, not string
                    participant.rtp_capabilities = rtpCapabilities;
                    room.set(peerId, participant);

                    return {
                        success: true,
                        message: 'RTP capabilities updated successfully',
                        roomId: roomId,
                    };
                }
            }

            return {
                success: false,
                error: 'Participant not found in any room',
            };
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

    // Add these methods to RoomService class
    lockRoom(roomId: string, password: string, creatorId: string): boolean {
        try {
            // Store room password with metadata
            this.roomPasswords.set(roomId, {
                password: password,
                creator_id: creatorId,
            });

            return true;
        } catch (error) {
            return false;
        }
    }

    unlockRoom(roomId: string, creatorId: string): boolean {
        try {
            const roomPassword = this.roomPasswords.get(roomId);

            if (!roomPassword) {
                return true;
            }

            // Verify the creator
            if (roomPassword.creator_id !== creatorId) {
                return false;
            }

            // Remove the password
            this.roomPasswords.delete(roomId);
            return true;
        } catch (error) {
            return false;
        }
    }

    isRoomLocked(roomId: string): boolean {
        return this.roomPasswords.has(roomId);
    }

    verifyRoomPassword(roomId: string, password: string): boolean {
        const roomPassword = this.roomPasswords.get(roomId);

        if (!roomPassword) {
            // Room is not locked, so any password is valid (or no password needed)
            return true;
        }

        return roomPassword.password === password;
    }

    getRoomPassword(
        roomId: string,
    ): { password: string; creator_id: string } | null {
        return this.roomPasswords.get(roomId) || null;
    }

    // Clean up room passwords when room is deleted
    private cleanupRoomPassword(roomId: string): void {
        if (this.roomPasswords.has(roomId)) {
            this.roomPasswords.delete(roomId);
        }
    }

    // Update existing removeRoom method to include password cleanup
    async removeRoom(roomId: string): Promise<boolean> {
        try {
            // Clean up all room data
            this.rooms.delete(roomId);
            this.cleanupRoomPassword(roomId);

            // Clean up organization room metadata if it exists
            if (this.orgRooms.has(roomId)) {
                this.orgRooms.delete(roomId);
            }
            return true;
        } catch (error) {
            console.error(`Failed to remove room ${roomId}:`, error);
            return false;
        }
    }
}
