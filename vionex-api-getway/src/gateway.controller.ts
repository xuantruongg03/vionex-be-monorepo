import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    HttpException,
    HttpStatus,
    Param,
    Post,
    Put,
    Query,
} from '@nestjs/common';
import * as mediasoupTypes from 'mediasoup/node/lib/types';
import { AudioClientService } from './clients/audio.client';
import { RoomClientService } from './clients/room.client';
import { SfuClientService } from './clients/sfu.client';
import { Participant } from './interfaces/interface';
import { HttpBroadcastService } from './services/http-broadcast.service';

@Controller()
export class GatewayController {
    // This controller can be used to define REST endpoints if needed.
    // Currently, it is empty as the WebSocket functionality is handled in GatewayGateway.
    constructor(
        private readonly roomClient: RoomClientService,
        private readonly broadcastService: HttpBroadcastService,
        private readonly sfuClient: SfuClientService,
        private readonly audioClient: AudioClientService,
    ) {}

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

    // Helper method to get participant from header
    private async getParticipantFromHeader(
        authorization?: string,
    ): Promise<Participant> {
        if (!authorization) {
            throw new HttpException(
                'No authorization header provided',
                HttpStatus.UNAUTHORIZED,
            );
        }

        // Extract peerId from authorization header
        const encodedPeerId = authorization.replace('Bearer ', '');

        try {
            // URL decode the peerId to handle encoded characters (like Vietnamese characters)
            const peerId = decodeURIComponent(encodedPeerId);

            // Find participant by peerId
            const participant = await this.findParticipantInAnyRoom(peerId);

            if (participant) {
                return participant;
            }

            throw new HttpException(
                'Participant not found. Please ensure you are using the correct peerId in the Authorization header.',
                HttpStatus.NOT_FOUND,
            );
        } catch (error) {
            console.error('Error getting participant:', error);
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                'Failed to get participant',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // Helper method to find participant in any room by peerId
    private async findParticipantInAnyRoom(
        peerId: string,
    ): Promise<Participant | null> {
        try {
            // Try to get participant by peerId - this should work if the room service supports it
            const roomId = await this.roomClient.getParticipantRoom(peerId);

            if (roomId) {
                const participant =
                    await this.roomClient.getParticipantByPeerId(
                        roomId,
                        peerId,
                    );
                if (participant) {
                    return participant;
                }
            }

            return null;
        } catch (error) {
            console.error('Error finding participant by peerId:', error);
            return null;
        }
    }

    // HTTP endpoint for setting RTP capabilities
    @Put('sfu/rtp-capabilities')
    async setRtpCapabilities(
        @Body() data: { rtpCapabilities: mediasoupTypes.RtpCapabilities },
        @Headers('authorization') authorization?: string,
    ) {
        try {
            const participant =
                await this.getParticipantFromHeader(authorization);

            // Update the participant's RTP capabilities in the room service
            const updateResult =
                await this.roomClient.updateParticipantRtpCapabilities(
                    participant.peer_id,
                    data.rtpCapabilities,
                );

            if (!updateResult.success) {
                console.error(
                    'Failed to update RTP capabilities in room service:',
                    updateResult.error,
                );
                throw new HttpException(
                    'Failed to save RTP capabilities',
                    HttpStatus.INTERNAL_SERVER_ERROR,
                );
            }

            console.log(
                'RTP capabilities successfully saved for participant:',
                participant.peer_id,
            );

            return {
                success: true,
                message: 'RTP capabilities set successfully',
            };
        } catch (error) {
            console.error('Error setting RTP capabilities:', error);
            throw new HttpException(
                error.message || 'Failed to set RTP capabilities',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // HTTP endpoint for getting users in room
    @Get('sfu/rooms/:roomId/users')
    async getUsersInRoom(
        @Param('roomId') roomId: string,
        @Headers('authorization') authorization?: string,
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

    // HTTP endpoint for getting streams in room
    @Get('sfu/rooms/:roomId/streams')
    async getStreamsInRoom(
        @Param('roomId') roomId: string,
        @Headers('authorization') authorization?: string,
    ) {
        try {
            const streamsResponse = await this.sfuClient.getStreams(roomId);
            // Check if response is empty or not an array
            if (!streamsResponse) {
                return { success: true, streams: [] };
            }

            // Handle different response formats from SFU service
            let streamsArray: any[] = [];
            if (Array.isArray(streamsResponse)) {
                streamsArray = streamsResponse;
            } else if (
                (streamsResponse as any).streams &&
                Array.isArray((streamsResponse as any).streams)
            ) {
                streamsArray = (streamsResponse as any).streams;
            } else if (
                (streamsResponse as any).data &&
                Array.isArray((streamsResponse as any).data)
            ) {
                streamsArray = (streamsResponse as any).data;
            } else {
                console.log(
                    'SFU getStreams returned non-array response, returning empty array',
                );
                return { success: true, streams: [] };
            }

            if (streamsArray.length === 0) {
                return { success: true, streams: [] };
            }

            // Return complete stream data including metadata with proper field mapping
            const availableStreams = streamsArray.map((stream: any) => ({
                streamId: stream.streamId || stream.stream_id,
                publisherId: stream.publisherId || stream.publisher_id,
                producerId: stream.producerId || stream.producer_id,
                metadata: stream.metadata
                    ? typeof stream.metadata === 'string'
                        ? JSON.parse(stream.metadata)
                        : stream.metadata
                    : {},
                rtpParameters: stream.rtpParameters
                    ? typeof stream.rtpParameters === 'string'
                        ? JSON.parse(stream.rtpParameters)
                        : stream.rtpParameters
                    : {},
                roomId: stream.roomId || stream.room_id,
            }));

            return {
                success: true,
                streams: availableStreams,
            };
        } catch (error) {
            console.error('Error getting streams:', error);
            throw new HttpException(
                error.message || 'Failed to get streams',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // HTTP endpoint for getting router RTP capabilities
    @Get('sfu/rooms/:roomId/router-capabilities')
    async getRouterRtpCapabilities(
        @Param('roomId') roomId: string,
        @Headers('authorization') authorization?: string,
    ) {
        try {
            const roomData = await this.sfuClient.createMediaRoom(roomId);
            return {
                success: true,
                data: (roomData as any).router?.rtpCapabilities || null,
            };
        } catch (error) {
            console.error('Error getting router RTP capabilities:', error);
            throw new HttpException(
                error.message || 'Failed to get router RTP capabilities',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // HTTP endpoint for connecting transport
    @Post('sfu/transport/:transportId/connect')
    async connectTransport(
        @Param('transportId') transportId: string,
        @Body() data: { dtlsParameters: any; roomId: string },
        @Headers('authorization') authorization?: string,
    ) {
        try {
            const participant =
                await this.getParticipantFromHeader(authorization);

            await this.sfuClient.connectTransport(
                transportId,
                data.dtlsParameters,
                data.roomId,
                participant.peer_id,
            );

            return {
                success: true,
                message: 'Transport connected successfully',
            };
        } catch (error) {
            console.error('Error connecting transport:', error);
            throw new HttpException(
                error.message || 'Failed to connect transport',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // HTTP endpoint for producing media
    @Post('sfu/transport/:transportId/produce')
    async produce(
        @Param('transportId') transportId: string,
        @Body()
        data: {
            roomId: string;
            kind: 'audio' | 'video';
            rtpParameters: any;
            appData?: any;
            participantId?: string;
        },
        @Headers('authorization') authorization?: string,
    ) {
        try {
            const participant =
                await this.getParticipantFromHeader(authorization);

            const result = await this.sfuClient.createProducer(
                transportId,
                data.kind,
                data.rtpParameters,
                data.appData,
                data.roomId,
                data.participantId || participant.peer_id,
            );

            // Extract streamId from SFU service response
            const participantId = data.participantId || participant.peer_id;
            let streamId: string;

            // Try to get streamId from different possible locations in the response
            if ((result as any).streamId) {
                // Direct streamId field
                streamId = (result as any).streamId;
                console.log('Using streamId from direct field:', streamId);
            } else if (
                (result as any).producer &&
                (result as any).producer.streamId
            ) {
                // StreamId in producer object
                streamId = (result as any).producer.streamId;
            } else {
                // Check for producer_data field (from proto)
                const resultWithProducerData = result as any;
                if (resultWithProducerData.producer_data) {
                    try {
                        const producerData = JSON.parse(
                            resultWithProducerData.producer_data,
                        );
                        streamId = producerData.streamId;
                        console.log(
                            'Using streamId from producer_data:',
                            streamId,
                        );
                    } catch (error) {
                        console.error('Failed to parse producer_data:', error);
                        throw new HttpException(
                            'Invalid producer data from SFU service',
                            HttpStatus.INTERNAL_SERVER_ERROR,
                        );
                    }
                } else {
                    console.error('No streamId found in result:', result);
                    throw new HttpException(
                        'No streamId received from SFU service',
                        HttpStatus.INTERNAL_SERVER_ERROR,
                    );
                }
            }

            // Broadcast stream-added event to other clients in the room via WebSocket
            const streamInfo = {
                streamId: streamId,
                publisherId: participantId,
                producerId: (result as any).producerId,
                metadata: data.appData || {},
                rtpParameters: data.rtpParameters,
            };

            // Use broadcast service to notify other clients
            this.broadcastService.broadcastToRoom(
                data.roomId,
                'sfu:stream-added',
                streamInfo,
            );

            return {
                success: true,
                data: {
                    id: (result as any).producerId,
                    kind: data.kind,
                    rtpParameters: data.rtpParameters,
                    producerId: (result as any).producerId,
                },
            };
        } catch (error) {
            console.error('Error producing media:', error);
            throw new HttpException(
                error.message || 'Failed to produce media',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // HTTP endpoint for consuming media
    @Post('sfu/transport/:transportId/consume')
    async consume(
        @Param('transportId') transportId: string,
        @Body()
        data: {
            roomId: string;
            streamId: string;
            rtpCapabilities: any;
            participantId?: string;
        },
        @Headers('authorization') authorization?: string,
    ) {
        try {
            // Validate streamId before proceeding
            if (!data.streamId || data.streamId === 'undefined') {
                console.error(
                    'Invalid streamId in consume request:',
                    data.streamId,
                );
                throw new HttpException(
                    `Invalid streamId: ${data.streamId}. StreamId cannot be undefined or null.`,
                    HttpStatus.BAD_REQUEST,
                );
            }

            const participant =
                await this.getParticipantFromHeader(authorization);

            // Ensure we have a valid roomId - try multiple sources
            let roomId: string | undefined = data.roomId;
            if (!roomId || roomId === 'undefined') {
                const participantRoom =
                    await this.roomClient.getParticipantRoom(
                        participant.peer_id,
                    );
                roomId = participantRoom || undefined;
            }

            if (!roomId || roomId === 'undefined') {
                throw new HttpException(
                    'Room ID is required and could not be determined',
                    HttpStatus.BAD_REQUEST,
                );
            }

            // Get participant's RTP capabilities from room service (previously set via setRtpCapabilities)
            const participantData =
                await this.roomClient.getParticipantByPeerId(
                    roomId,
                    participant.peer_id,
                );

            let rtpCapabilities = data.rtpCapabilities; // Default to request data

            if (participantData && participantData.rtp_capabilities) {
                try {
                    // Parse stored RTP capabilities
                    const storedRtpCapabilities =
                        typeof participantData.rtp_capabilities === 'string'
                            ? JSON.parse(participantData.rtp_capabilities)
                            : participantData.rtp_capabilities;

                    if (storedRtpCapabilities && storedRtpCapabilities.codecs) {
                        rtpCapabilities = storedRtpCapabilities;
                    }
                } catch (error) {
                    console.error(
                        'Error parsing stored RTP capabilities:',
                        error,
                    );
                    console.log(
                        'Using RTP capabilities from request (fallback)',
                    );
                }
            }

            const result = await this.sfuClient.createConsumer(
                data.streamId,
                transportId,
                roomId, // Use the resolved roomId, not data.roomId
                participant.peer_id,
            );

            // Broadcast consumer-created event to the requesting client via WebSocket
            const consumerInfo = {
                consumerId: (result as any).data?.consumerId,
                streamId: data.streamId,
                producerId: (result as any).data?.producerId,
                kind: (result as any).data?.kind,
                rtpParameters: (result as any).data?.rtpParameters,
            };

            // Send consumer-created event to the specific client (not broadcast to room)
            this.broadcastService.broadcastToUser(
                participant.socket_id,
                'sfu:consumer-created',
                consumerInfo,
            );

            return {
                success: true,
                data: {
                    id: (result as any).data?.consumerId,
                    kind: (result as any).data?.kind,
                    rtpParameters: (result as any).data?.rtpParameters,
                    producerId: (result as any).data?.producerId,
                    paused: false,
                },
            };
        } catch (error) {
            console.error('Error consuming media:', error);
            throw new HttpException(
                error.message || 'Failed to consume media',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // HTTP endpoint for resuming consumer
    @Post('sfu/consumer/:consumerId/resume')
    async resumeConsumer(
        @Param('consumerId') consumerId: string,
        @Body() data: { roomId: string; participantId?: string },
        @Headers('authorization') authorization?: string,
    ) {
        try {
            console.log('=== Resume Consumer ===');
            console.log('Consumer ID:', consumerId);
            console.log('Room ID:', data.roomId);

            const participant =
                await this.getParticipantFromHeader(authorization);

            await this.sfuClient.resumeConsumer(
                consumerId,
                data.roomId,
                data.participantId || participant.peer_id,
            );
            console.log('Consumer resumed successfully');

            return {
                success: true,
                message: 'Consumer resumed successfully',
            };
        } catch (error) {
            console.error('Error resuming consumer:', error);
            throw new HttpException(
                error.message || 'Failed to resume consumer',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // HTTP endpoint for closing producer
    @Delete('sfu/producer/:producerId')
    async closeProducer(
        @Param('producerId') producerId: string,
        @Body() data: { roomId: string },
        @Headers('authorization') authorization?: string,
    ) {
        try {
            const participant =
                await this.getParticipantFromHeader(authorization);

            // Use removeParticipantMedia to clean up producer
            await this.sfuClient.removeParticipantMedia({
                room_id: data.roomId,
                participant_id: participant.peer_id,
            });

            return {
                success: true,
                message: 'Producer closed successfully',
            };
        } catch (error) {
            console.error('Error closing producer:', error);
            throw new HttpException(
                error.message || 'Failed to close producer',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    // ===== TRANSLATION CABIN ENDPOINTS =====

    @Post('translation-cabin')
    async createTranslationCabin(
        @Body()
        data: {
            roomId: string;
            sourceUserId: string;
            targetUserId: string;
            sourceLanguage: string;
            targetLanguage: string;
        },
    ) {
        // B1. Audio service opens port for plainRTP
        const audioPortResponse =
            await this.audioClient.allocateTranslationPort(
                data.roomId,
                data.targetUserId,
                // sourceLanguage and targetLanguage will be passed in B3 step
            );
        if (!audioPortResponse.success || !audioPortResponse.port) {
            throw new HttpException(
                'Failed to allocate audio port',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }

        // B2. SFU service establishes plainRTP connection to audio service
        const sfuPortResponse =
            await this.sfuClient.establishPlainRtpConnection(
                data.roomId,
                data.sourceUserId,
                data.targetUserId,
                data.sourceLanguage,
                data.targetLanguage,
                audioPortResponse.port,
                audioPortResponse.send_port, // Use snake_case as returned by audio service
                audioPortResponse.ssrc, // Pass SSRC from Audio Service to SFU
            );
        if (!sfuPortResponse.success) {
            throw new HttpException(
                sfuPortResponse.message || 'Failed to establish RTP connection',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }

        // B3. Start translation cabin processing
        const translationProduceResponse =
            await this.audioClient.createTranslationProduce(
                data.roomId,
                data.targetUserId,
                data.sourceLanguage,
                data.targetLanguage,
            );
        if (!translationProduceResponse.success) {
            throw new HttpException(
                translationProduceResponse.message ||
                    'Failed to start translation processing',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }

        // B4. Return streamId for client consumption
        return {
            success: true,
            data: {
                streamId: sfuPortResponse.streamId,
            },
            message: 'Translation cabin created successfully',
        };
    }

    @Post('destroy-translation-cabin')
    async destroyTranslationCabin(
        @Body()
        data: {
            roomId: string;
            sourceUserId: string;
            targetUserId: string;
            sourceLanguage: string;
            targetLanguage: string;
        },
    ) {
        // Validate data
        if (
            !data.roomId ||
            !data.targetUserId ||
            !data.sourceLanguage ||
            !data.targetLanguage
        ) {
            return {
                success: false,
                message:
                    'Missing required fields for destroying translation cabin',
            };
        }
        const destroyResponse = await this.sfuClient.destroyTranslationCabin(
            data.roomId,
            data.sourceUserId,
            data.targetUserId,
            data.sourceLanguage,
            data.targetLanguage,
        );

        if (!destroyResponse.success) {
            throw new HttpException(
                destroyResponse.message ||
                    'Failed to destroy translation cabin',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        } else {
            // 10001 is code in message from sfu to mark cabin is not use and destroy success
            // Can search full message in SFU to see details
            if (destroyResponse.message === '10001') {
                const destroyCabinTranslationResponse =
                    await this.audioClient.destroyTranslationCabin(
                        data.roomId,
                        data.targetUserId,
                        data.sourceLanguage,
                        data.targetLanguage,
                    );

                if (!destroyCabinTranslationResponse.success) {
                    throw new HttpException(
                        destroyCabinTranslationResponse.message ||
                            'Failed to destroy translation cabin',
                        HttpStatus.INTERNAL_SERVER_ERROR,
                    );
                }
            }
        }
        return {
            success: true,
            message: 'Translation cabin destroyed successfully',
        };
    }

    @Get('list-translation-cabin')
    async listTranslationCabin(
        @Query()
        params: {
            roomId: string;
            userId: string;
        },
    ) {
        const listResponse = await this.sfuClient.listTranslationCabin(
            params.roomId,
            params.userId,
        );
        if (!listResponse.success) {
            throw new HttpException(
                'Failed to list translation cabins',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
        return {
            success: true,
            data: listResponse.cabins,
            message: 'Translation cabins listed successfully',
        };
    }
}
