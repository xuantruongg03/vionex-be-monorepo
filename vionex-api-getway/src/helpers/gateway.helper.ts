import { Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { RoomClientService } from '../clients/room.client';
import { SfuClientService } from '../clients/sfu.client';
import { logger } from '../utils/log-manager';

@Injectable()
export class GatewayHelperService {
    // Maps for tracking connections and participants
    private connectionMap = new Map<string, string>(); // socketId -> peerId
    private participantSocketMap = new Map<string, string>(); // peerId -> socketId
    private roomParticipantMap = new Map<string, string>(); // peerId -> roomId
    private participantCache = new Map<string, any>(); // peerId -> participant object

    constructor(
        private readonly roomClient: RoomClientService,
        private readonly sfuClient: SfuClientService,
    ) {}

    // ==================== SERVICE AVAILABILITY METHODS ====================

    /**
     * Check if error is a service unavailability error
     */
    private isServiceUnavailableError(error: any): boolean {
        if (!error) return false;

        // Check for gRPC errors
        if (error.code) {
            // gRPC status codes for unavailability
            const unavailableCodes = [
                14, // UNAVAILABLE
                2, // UNKNOWN (connection issues)
                4, // DEADLINE_EXCEEDED
            ];
            if (unavailableCodes.includes(error.code)) {
                return true;
            }
        }

        // Check for common connection error messages
        const errorMessage = error.message?.toLowerCase() || '';
        const unavailablePatterns = [
            'econnrefused',
            'enotfound',
            'etimedout',
            'unavailable',
            'connection refused',
            'connection timeout',
            'service not available',
            'failed to connect',
            'network error',
            'socket hang up',
        ];

        return unavailablePatterns.some((pattern) =>
            errorMessage.includes(pattern),
        );
    }

    /**
     * Get service name from error context
     */
    private getServiceNameFromError(
        error: any,
        defaultService: string = 'Service',
    ): string {
        // Try to extract service name from error metadata
        if (error.metadata) {
            const service = error.metadata.get('service-name');
            if (service) return service;
        }

        // Try to extract from error message
        const message = error.message || '';
        if (message.includes('RoomService')) return 'Room Service';
        if (message.includes('SfuService')) return 'SFU Service';
        if (message.includes('AudioService')) return 'Audio Service';
        if (message.includes('InteractionService'))
            return 'Interaction Service';
        if (message.includes('ChatBotService')) return 'ChatBot Service';
        if (message.includes('ChatService')) return 'Chat Service';

        return defaultService;
    }

    /**
     * Handle service error and emit to client if service is unavailable
     * @param socket - Socket.io client socket
     * @param error - Error object from service call
     * @param serviceName - Name of the service (optional, will try to auto-detect)
     * @param eventName - Event name for logging context (optional)
     * @returns true if error was handled as service unavailable, false otherwise
     */
    handleServiceError(
        socket: Socket,
        error: any,
        serviceName?: string,
        eventName?: string,
    ): boolean {
        // Check if this is a service unavailability error
        if (!this.isServiceUnavailableError(error)) {
            return false;
        }

        // Determine service name
        const service = serviceName || this.getServiceNameFromError(error);
        const event = eventName ? ` for event '${eventName}'` : '';

        // Log the service unavailability
        logger.error(
            'gateway.helper.ts',
            `[GatewayHelper] ${service} is not available${event} - Socket: ${socket.id}, Error: ${error.message}, Code: ${error.code || 'N/A'}`,
        );

        // Emit error to client
        socket.emit('error', {
            type: 'SERVICE_UNAVAILABLE',
            message: `${service} is not available. Please try again later.`,
            service: service,
            timestamp: new Date().toISOString(),
        });

        return true;
    }

    /**
     * Wrap a service call with automatic error handling
     * @param socket - Socket.io client socket
     * @param serviceCall - Async function that calls the service
     * @param serviceName - Name of the service
     * @param eventName - Event name for logging context
     * @returns Result of service call or null if service is unavailable
     */
    async callServiceSafely<T>(
        socket: Socket,
        serviceCall: () => Promise<T>,
        serviceName: string,
        eventName?: string,
    ): Promise<T | null> {
        try {
            return await serviceCall();
        } catch (error) {
            // Handle service unavailability
            const handled = this.handleServiceError(
                socket,
                error,
                serviceName,
                eventName,
            );

            if (!handled) {
                // Re-throw if not a service unavailability error
                throw error;
            }

            return null;
        }
    }

    // ==================== PARTICIPANT MAPPING METHODS ====================

    /**
     * Store participant mapping information
     */
    storeParticipantMapping(
        socketId: string,
        peerId: string,
        roomId: string,
        participantData?: any,
    ): void {
        this.connectionMap.set(socketId, peerId);
        this.participantSocketMap.set(peerId, socketId);
        this.roomParticipantMap.set(peerId, roomId);

        // Cache participant data if provided
        if (participantData) {
            this.participantCache.set(peerId, participantData);
        }
    }

    /**
     * Clean up participant mapping when socket disconnects
     */
    cleanupParticipantMapping(socketId: string): void {
        const peerId = this.connectionMap.get(socketId);
        if (peerId) {
            this.connectionMap.delete(socketId);
            this.participantSocketMap.delete(peerId);
            this.roomParticipantMap.delete(peerId);
            this.participantCache.delete(peerId);
        }
    }

    /**
     * Get participant ID by socket ID
     */
    getParticipantBySocketId(socketId: string): string | null {
        return this.connectionMap.get(socketId) || null;
    }

    /**
     * Get room ID by socket ID
     */
    async getRoomIdBySocketId(socketId: string): Promise<string | null> {
        const peerId = this.connectionMap.get(socketId);
        if (peerId) {
            const roomId = this.roomParticipantMap.get(peerId);
            return roomId || null;
        }
        return null;
    }

    /**
     * Get socket ID by peer ID
     */
    getSocketIdByPeerId(peerId: string): string | null {
        return this.participantSocketMap.get(peerId) || null;
    }

    /**
     * Get participant data by peer ID with caching and fallback to room service
     */
    async getParticipantByPeerId(roomId: string, peerId: string): Promise<any> {
        try {
            // First check if we have cached participant data
            const cachedParticipant = this.participantCache.get(peerId);
            if (cachedParticipant) {
                return cachedParticipant;
            }

            // Check if we have this peerId in our local mappings
            const mappedRoomId = this.roomParticipantMap.get(peerId);
            const socketId = this.participantSocketMap.get(peerId);

            // If we have local mapping for this peerId and it matches the requested roomId
            if (mappedRoomId === roomId && socketId) {
                // Return a minimal participant object from mappings
                const participant = {
                    peer_id: peerId,
                    socket_id: socketId,
                    is_creator: false, // We don't cache this, but it's not critical for audio validation
                    room_id: roomId,
                };

                // Cache this minimal participant data
                this.participantCache.set(peerId, participant);
                return participant;
            }

            // Fallback to room service
            const participant = await this.roomClient.getParticipantByPeerId(
                roomId,
                peerId,
            );

            if (participant) {
                // Update our local cache and mappings
                this.storeParticipantMapping(
                    participant.socket_id,
                    peerId,
                    roomId,
                    participant,
                );
            } else {
                logger.info(
                    'gateway.helper.ts',
                    `[GatewayHelper] Participant ${peerId} not found via room service`,
                );
            }

            return participant;
        } catch (error) {
            logger.error(
                'gateway.helper.ts',
                `[GatewayHelper] Error getting participant ${peerId} in room ${roomId}: ${error}`,
            );
            return null;
        }
    }

    // ==================== ROOM AND PARTICIPANTS METHODS ====================

    /**
     * Get all rooms with their participants
     */
    async getAllRoomsWithParticipants(): Promise<Map<string, any[]>> {
        try {
            const roomsMap = new Map<string, any[]>();

            // Scan through existing participant mappings
            for (const [peerId, roomId] of this.roomParticipantMap) {
                if (!roomsMap.has(roomId)) {
                    roomsMap.set(roomId, []);
                }
                roomsMap.get(roomId)?.push({
                    peer_id: peerId,
                    peerId: peerId,
                    socket_id: this.participantSocketMap.get(peerId),
                });
            }

            return roomsMap;
        } catch (error) {
            logger.error(
                'gateway.helper.ts',
                `[GatewayHelper] Error getting all rooms: ${error}`,
            );
            return new Map();
        }
    }

    /**
     * Get all participants in a room
     */
    async getAllParticipantsInRoom(roomId: string): Promise<any[]> {
        try {
            const updatedRoom = await this.roomClient.getRoom(roomId);
            if (
                updatedRoom &&
                updatedRoom.data &&
                updatedRoom.data.participants
            ) {
                return updatedRoom.data.participants.map(
                    (participant: any) => ({
                        peer_id: participant.peer_id,
                        peerId: participant.peer_id,
                        is_creator: participant.is_creator,
                        time_arrive: participant.time_arrive,
                    }),
                );
            }
            return [];
        } catch (error) {
            logger.error(
                'gateway.helper.ts',
                `[GatewayHelper] Error getting participants for room ${roomId}: ${error}`,
            );
            return [];
        }
    }

    // ==================== AUDIO/VIDEO VALIDATION METHODS ====================

    /**
     * Validate audio chunk data
     */
    validateAudioChunk(data: {
        userId: string;
        roomId: string;
        timestamp: number;
        buffer: number[] | ArrayBuffer;
        duration: number;
    }): boolean {
        if (!data.userId || typeof data.userId !== 'string') {
            logger.warn(
                'gateway.helper.ts',
                '[GatewayHelper] Invalid userId in audio chunk',
            );
            return false;
        }

        if (!data.roomId || typeof data.roomId !== 'string') {
            logger.warn(
                'gateway.helper.ts',
                '[GatewayHelper] Invalid roomId in audio chunk',
            );
            return false;
        }

        if (!data.timestamp || typeof data.timestamp !== 'number') {
            logger.warn(
                'gateway.helper.ts',
                '[GatewayHelper] Invalid timestamp in audio chunk',
            );
            return false;
        }

        // Handle both array and ArrayBuffer formats
        let bufferSize = 0;
        if (Array.isArray(data.buffer)) {
            bufferSize = data.buffer.length;
        } else if (data.buffer instanceof ArrayBuffer) {
            bufferSize = data.buffer.byteLength;
        } else {
            logger.warn(
                'gateway.helper.ts',
                '[GatewayHelper] Invalid buffer format in audio chunk',
            );
            return false;
        }

        if (
            !data.duration ||
            typeof data.duration !== 'number' ||
            data.duration <= 0
        ) {
            logger.warn(
                'gateway.helper.ts',
                '[GatewayHelper] Invalid duration in audio chunk',
            );
            return false;
        }

        // Check reasonable audio buffer size (100ms to 3s of 16kHz 16-bit mono)
        const minSize = 16000 * 2 * 0.1; // 100ms = 3,200 bytes
        const maxSize = 16000 * 2 * 3; // 3s = 96,000 bytes

        if (bufferSize < minSize || bufferSize > maxSize) {
            logger.warn(
                'gateway.helper.ts',
                `[GatewayHelper] Audio buffer size out of range: ${bufferSize} bytes (min: ${minSize}, max: ${maxSize})`,
            );
            return false;
        }

        return true;
    }

    /**
     * Verify user is in room
     */
    async verifyUserInRoom(
        socketId: string,
        userId: string,
        roomId: string,
    ): Promise<boolean> {
        try {
            // Check if socket is mapped to this user
            const mappedPeerId = this.connectionMap.get(socketId);
            if (mappedPeerId !== userId) {
                logger.warn(
                    'gateway.helper.ts',
                    `[GatewayHelper] Socket ${socketId} not mapped to user ${userId}`,
                );
                return false;
            }

            // Verify user is participant in room
            const participant = await this.roomClient.getParticipantByPeerId(
                roomId,
                userId,
            );
            if (!participant) {
                logger.warn(
                    'gateway.helper.ts',
                    `[GatewayHelper] User ${userId} not found in room ${roomId}`,
                );
                return false;
            }

            // Check if participant's socket matches
            if (participant.socket_id !== socketId) {
                logger.warn(
                    'gateway.helper.ts',
                    `[GatewayHelper] Socket mismatch for user ${userId} in room ${roomId}`,
                );
                return false;
            }

            return true;
        } catch (error) {
            logger.error(
                'gateway.helper.ts',
                `[GatewayHelper] Error verifying user in room: ${error}`,
            );
            return false;
        }
    }

    // ==================== STREAM METHODS ====================

    /**
     * Get streams from speaking user that should be prioritized
     */
    async getSpeakingUserStreams(
        roomId: string,
        speakingPeerId: string,
    ): Promise<any[]> {
        try {
            // Get all streams from SFU for this room
            const allStreams = await this.sfuClient.getStreams(roomId);

            if (!allStreams) {
                return [];
            }

            // Cast to any to handle dynamic response structure
            const streamsData = allStreams as any;
            const streams = streamsData.streams || streamsData.data || [];

            // Filter streams from the speaking user (audio/video, not screen share)
            const userStreams = streams.filter((stream: any) => {
                const streamId = stream.streamId || stream.stream_id;
                const publisherId = stream.publisherId || stream.publisher_id;

                // Must be from speaking user
                if (publisherId !== speakingPeerId) return false;

                // Parse stream ID to determine type
                const parts = streamId.split('_');
                const mediaType = parts[1]; // video, audio, screen, screen_audio

                // Only prioritize regular audio/video streams, not screen shares
                return mediaType === 'video' || mediaType === 'audio';
            });

            return userStreams;
        } catch (error) {
            logger.error(
                'gateway.helper.ts',
                `[GatewayHelper] Error getting speaking user streams: ${error}`,
            );
            return [];
        }
    }

    // ==================== PARSING METHODS ====================

    /**
     * Parse stream metadata safely
     */
    parseStreamMetadata(metadata: any): any {
        try {
            if (!metadata) return { video: true, audio: true, type: 'webcam' };
            if (typeof metadata === 'string') {
                return JSON.parse(metadata);
            }
            return metadata;
        } catch (error) {
            logger.error(
                'gateway.helper.ts',
                `[GatewayHelper] Failed to parse stream metadata: ${error}`,
            );
            return { video: true, audio: true, type: 'webcam' };
        }
    }

    /**
     * Parse stream RTP parameters safely
     */
    parseStreamRtpParameters(rtpParameters: any): any {
        try {
            if (!rtpParameters) return {};
            if (typeof rtpParameters === 'string') {
                return JSON.parse(rtpParameters);
            }
            return rtpParameters;
        } catch (error) {
            logger.error(
                'gateway.helper.ts',
                `[GatewayHelper] Failed to parse stream RTP parameters: ${error}`,
            );
            return {};
        }
    }

    // ==================== GETTER METHODS FOR MAPS ====================

    /**
     * Get connection map (for specific use cases)
     */
    getConnectionMap(): Map<string, string> {
        return this.connectionMap;
    }

    /**
     * Get participant socket map (for specific use cases)
     */
    getParticipantSocketMap(): Map<string, string> {
        return this.participantSocketMap;
    }

    /**
     * Get room participant map (for specific use cases)
     */
    getRoomParticipantMap(): Map<string, string> {
        return this.roomParticipantMap;
    }

    /**
     * Get participant cache (for specific use cases)
     */
    getParticipantCache(): Map<string, any> {
        return this.participantCache;
    }
}
