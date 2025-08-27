import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AudioClientService } from './clients/audio.client';
import { InteractionClientService } from './clients/interaction.client';
import { RoomClientService } from './clients/room.client';
import { SfuClientService } from './clients/sfu.client';
import { ChatHandler } from './handlers/chat.handler';
import { Participant } from './interfaces/interface';
import { HttpBroadcastService } from './services/http-broadcast.service';
import { WebSocketEventService } from './services/websocket-event.service';

@WebSocketGateway({
    transports: ['websocket', 'polling'],
    cors: { origin: '*', credentials: true },
    path: '/socket.io',
    serveClient: false,
    allowUpgrades: true,
    pingTimeout: 60000,
    pingInterval: 25000,
})
export class GatewayGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
    @WebSocketServer() io: Server;
    private connectionMap = new Map<string, string>(); // socketId -> peerId
    private participantSocketMap = new Map<string, string>(); // peerId -> socketId
    private roomParticipantMap = new Map<string, string>(); // peerId -> roomId
    private participantCache = new Map<string, any>(); // peerId -> participant object

    constructor(
        private readonly eventService: WebSocketEventService,
        private readonly roomClient: RoomClientService,
        private readonly httpBroadcastService: HttpBroadcastService,
        private readonly sfuClient: SfuClientService,
        private readonly interactionClient: InteractionClientService,
        private readonly audioService: AudioClientService,
        private readonly chatHandler: ChatHandler,
    ) {}

    afterInit(server: Server) {
        this.httpBroadcastService.setSocketServer(server);
    }

    handleConnection(client: Socket) {
        // Ensure socket server is set (backup in case afterInit didn't run)
        if (!this.httpBroadcastService['io']) {
            this.httpBroadcastService.setSocketServer(this.io);
        }
    }

    async handleDisconnect(client: Socket) {
        // Get participant info before cleanup
        let peerId = this.connectionMap.get(client.id);
        let roomId = peerId ? this.roomParticipantMap.get(peerId) : null;

        if (!peerId || !roomId) {
            try {
                const participantInfo =
                    await this.roomClient.findParticipantBySocketId(client.id);
                if (participantInfo) {
                    peerId = participantInfo.peerId;
                    roomId = participantInfo.roomId;
                }
            } catch (error) {
                console.log(
                    `[Gateway] Room service lookup failed, will try scanning approach`,
                );

                // Fallback: Search through socket.io rooms to find participant
                try {
                    // If still not found, do full scan
                    if (!peerId || !roomId) {
                        const allRooms =
                            await this.getAllRoomsWithParticipants();

                        for (const [currentRoomId, participants] of allRooms) {
                            const participant = participants.find(
                                (p) =>
                                    p.socket_id === client.id ||
                                    (p.socket_id &&
                                        p.socket_id.includes(client.id)),
                            );

                            if (participant) {
                                peerId =
                                    participant.peer_id || participant.peerId;
                                roomId = currentRoomId;
                                break;
                            }
                        }
                    }
                } catch (scanError) {
                    console.error(
                        `[Gateway] Error scanning for participant:`,
                        scanError,
                    );
                }
            }
        }

        if (peerId && roomId) {
            try {
                try {
                    const removeMediaResponse =
                        await this.sfuClient.removeParticipantMedia({
                            room_id: roomId,
                            participant_id: peerId,
                        });

                    // Broadcast stream-removed events for each removed stream
                    if (
                        removeMediaResponse &&
                        (removeMediaResponse as any).removed_streams &&
                        (removeMediaResponse as any).removed_streams.length > 0
                    ) {
                        for (const streamId of (removeMediaResponse as any)
                            .removed_streams) {
                            this.io.to(roomId).emit('sfu:stream-removed', {
                                streamId: streamId,
                                publisherId: peerId,
                            });
                        }
                    }
                } catch (error) {
                    console.error(
                        '[BACKEND] Error removing participant media:',
                        error,
                    );
                }
                const leaveRoomResponse = await this.roomClient.leaveRoom({
                    roomId: roomId,
                    participantId: peerId,
                    socketId: client.id,
                });

                // Have client leave the socket.io room
                client.leave(roomId);

                this.io.to(roomId).emit('sfu:peer-left', {
                    peerId: peerId,
                });

                this.io.to(roomId).emit('sfu:user-removed', {
                    peerId: peerId,
                });

                // If this was the creator and there's a new creator, send the creator-changed event
                const participant =
                    await this.roomClient.getParticipantByPeerId(
                        roomId,
                        peerId,
                    );
                if (
                    participant?.is_creator &&
                    leaveRoomResponse?.data?.newCreator
                ) {
                    this.io.to(roomId).emit('sfu:creator-changed', {
                        peerId: leaveRoomResponse.data.newCreator,
                        isCreator: true,
                    });
                }

                try {
                    const updatedRoom = await this.roomClient.getRoom(roomId);

                    if (
                        updatedRoom &&
                        updatedRoom.data &&
                        updatedRoom.data.participants
                    ) {
                        const users = updatedRoom.data.participants.map(
                            (participant: any) => ({
                                peerId: participant.peer_id,
                                isCreator: participant.is_creator,
                                timeArrive: participant.time_arrive,
                            }),
                        );
                        this.io.to(roomId).emit('sfu:users-updated', {
                            users: users,
                        });
                    }
                } catch (error) {
                    console.error(
                        '[BACKEND] Error broadcasting updated users list:',
                        error,
                    );
                }
            } catch (error) {
                console.error(
                    '[BACKEND] Error calling room service leave room:',
                    error,
                );
            }
        }

        // Clean up connection mapping
        this.cleanupParticipantMapping(client.id);
    }

    @SubscribeMessage('sfu:join')
    async handleJoin(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { roomId: string; peerId: string; password?: string },
    ) {
        console.log(data);

        // Check if room is password protected
        const isRoomLocked = await this.roomClient.isRoomLocked(data.roomId);
        if (isRoomLocked) {
            // If room is locked, password is required
            if (!data.password) {
                this.eventService.emitError(
                    client,
                    'This room is password protected',
                    'ROOM_PASSWORD_REQUIRED',
                );
                return;
            }

            // Verify the password
            const isValid = await this.roomClient.verifyRoomPassword(
                data.roomId,
                data.password,
            );

            //Password is invalid
            if (!isValid) {
                this.eventService.emitError(
                    client,
                    'Invalid room password',
                    'INVALID_ROOM_PASSWORD',
                );
                return;
            }
        }

        client.join(data.roomId);

        // Initialize room if needed
        let room = await this.roomClient.getRoom(data.roomId);
        if (!room.data || !room.data.room_id) {
            await this.roomClient.createRoom(data.roomId);
            // Create the media room in SFU service
            try {
                await this.sfuClient.createMediaRoom(data.roomId);
            } catch (error) {
                console.error('Failed to create media room:', error);
                this.eventService.emitError(
                    client,
                    'Failed to initialize media room',
                    'MEDIA_ROOM_ERROR',
                );
                return;
            }
            room = await this.roomClient.getRoom(data.roomId);
        }

        let hasExistingCreator = false;
        let isRoomEmpty = false;

        if (room.data?.participants && room.data.participants.length > 0) {
            const otherParticipants = room.data.participants.filter((p) => {
                const participantId = p.peerId || p.peer_id;
                return participantId !== data.peerId;
            });
            hasExistingCreator = otherParticipants.some(
                (p) => p.is_creator === true,
            );

            // Room trống nếu không có participant nào khác
            isRoomEmpty = otherParticipants.length === 0;
        } else {
            // Room không có participants nào
            isRoomEmpty = true;
        }

        const isCreator = !hasExistingCreator && isRoomEmpty;

        // Check if participant already exists
        const existingParticipant =
            await this.roomClient.getParticipantByPeerId(
                data.roomId,
                data.peerId,
            );

        if (existingParticipant) {
            // Update socket ID for reconnecting participant
            existingParticipant.socket_id = client.id;
            await this.roomClient.setParticipant(
                data.roomId,
                existingParticipant,
            );

            this.storeParticipantMapping(
                client.id,
                data.peerId,
                data.roomId,
                existingParticipant,
            );

            // Emit join success with existing participant data
            this.eventService.emitToClient(client, 'sfu:join-success', {
                peerId: existingParticipant.peer_id,
                isCreator: existingParticipant.is_creator,
                roomId: data.roomId,
            });

            // Send router capabilities
            try {
                const routerCapabilities =
                    await this.sfuClient.getRouterRtpCapabilities(data.roomId);
                this.eventService.emitToClient(
                    client,
                    'sfu:router-capabilities',
                    {
                        routerRtpCapabilities: routerCapabilities,
                    },
                );
            } catch (error) {
                console.error('Failed to get router capabilities:', error);
                this.eventService.emitError(
                    client,
                    'Failed to get router capabilities',
                    'ROUTER_ERROR',
                );
                return;
            }

            return; // Exit early for existing participant
        }

        // Check for duplicate peerId
        if (
            room.data?.participants?.some(
                (p) => (p.peerId || p.peer_id) === data.peerId,
            )
        ) {
            this.eventService.emitError(
                client,
                'Username already in use',
                'USERNAME_TAKEN',
            );
            return;
        }

        // Create new participant object only if no existing participant found
        const participant: Participant = {
            socket_id: client.id,
            peer_id: data.peerId,
            transports: new Map(),
            producers: new Map(),
            consumers: new Map(),
            is_creator: isCreator,
            time_arrive: new Date(),
        };
        try {
            await this.roomClient.setParticipant(data.roomId, participant);

            // Track the connection mapping for disconnect cleanup - IMPORTANT
            this.storeParticipantMapping(
                client.id,
                data.peerId,
                data.roomId,
                participant,
            );

            // Initialize whiteboard permissions if this is the creator
            if (participant.is_creator) {
                try {
                    await this.interactionClient.initializeRoomPermissions(
                        data.roomId,
                        data.peerId,
                    );
                } catch (error) {
                    console.error(
                        'Failed to initialize whiteboard permissions:',
                        error,
                    );
                    // Don't fail the join process for whiteboard initialization failure
                }
            }

            // Emit join success immediately after participant is added
            this.eventService.emitToClient(client, 'sfu:join-success', {
                peerId: participant.peer_id,
                isCreator: participant.is_creator,
                roomId: data.roomId,
            });

            // Broadcast new peer joined to existing clients
            this.eventService.broadcastToRoom(
                client,
                data.roomId,
                'sfu:new-peer-join',
                {
                    peerId: participant.peer_id,
                    isCreator: participant.is_creator,
                    timeArrive: participant.time_arrive,
                },
            );

            // Send updated users list to all clients
            try {
                const updatedRoom = await this.roomClient.getRoom(data.roomId);
                if (updatedRoom?.data?.participants) {
                    const users = updatedRoom.data.participants.map(
                        (p: any) => ({
                            peerId: p.peer_id,
                            isCreator: p.is_creator,
                            timeArrive: p.time_arrive,
                        }),
                    );

                    this.io
                        .to(data.roomId)
                        .emit('sfu:users-updated', { users });
                }
            } catch (error) {
                console.error('Error broadcasting updated users list:', error);
            }
        } catch (error) {
            console.error('Error setting participant:', error);
            this.eventService.emitError(
                client,
                'Failed to join room',
                'JOIN_ERROR',
            );
            return;
        }
        try {
            const routerCapabilities =
                await this.sfuClient.getRouterRtpCapabilities(data.roomId);

            this.eventService.emitToClient(client, 'sfu:router-capabilities', {
                routerRtpCapabilities: routerCapabilities,
            });
        } catch (error) {
            console.error('Failed to get router capabilities:', error);
            this.eventService.emitError(
                client,
                'Failed to get router capabilities',
                'ROUTER_ERROR',
            );
            return;
        }

        // Send existing streams to the new client
        try {
            const existingStreamsResponse = await this.sfuClient.getStreams(
                data.roomId,
            );
            const existingStreams =
                (existingStreamsResponse as any)?.streams || [];

            if (existingStreams?.length > 0) {
                const otherUserStreams = existingStreams.filter(
                    (stream) =>
                        stream.publisher_id !== data.peerId &&
                        stream.stream_id &&
                        stream.stream_id !== 'undefined',
                );

                if (otherUserStreams.length > 0) {
                    // Send streams to new client
                    this.eventService.emitToClient(
                        client,
                        'sfu:streams',
                        otherUserStreams,
                    );

                    // Send individual stream-added events
                    for (const stream of otherUserStreams) {
                        if (stream.stream_id && stream.publisher_id) {
                            const metadata = this.parseStreamMetadata(
                                stream.metadata,
                            );
                            const rtpParameters = this.parseStreamRtpParameters(
                                stream.rtp_parameters,
                            );

                            this.eventService.emitToClient(
                                client,
                                'sfu:stream-added',
                                {
                                    streamId: stream.stream_id,
                                    publisherId: stream.publisher_id,
                                    metadata,
                                    rtpParameters,
                                },
                            );
                        }
                    }
                } else {
                    this.eventService.emitToClient(client, 'sfu:streams', []);
                }
            } else {
                this.eventService.emitToClient(client, 'sfu:streams', []);
            }
        } catch (error) {
            console.error('Failed to get existing streams:', error);
            this.eventService.emitToClient(client, 'sfu:streams', []);
        }
    }

    @SubscribeMessage('sfu:set-rtp-capabilities')
    async handleSetRtpCapabilities(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { rtpCapabilities: any; roomId?: string; peerId?: string },
    ) {
        try {
            // Extract peerId from socket mapping
            const peerId =
                data.peerId || this.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId || (await this.getRoomIdBySocketId(client.id));

            if (!peerId || !roomId) {
                client.emit('sfu:error', {
                    message: 'Invalid participant or room information',
                });
                return {
                    success: false,
                    error: 'Invalid participant or room information',
                };
            }

            await this.sfuClient.setRtpCapabilities(
                peerId,
                data.rtpCapabilities,
                roomId,
            );

            client.emit('sfu:rtp-capabilities-set', { success: true });
            return { success: true };
        } catch (error) {
            client.emit('sfu:error', { message: error.message });
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('sfu:create-transport')
    async handleCreateTransport(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { roomId: string; isProducer: boolean; peerId?: string },
    ) {
        try {
            const peerId =
                data.peerId || this.getParticipantBySocketId(client.id);

            if (!peerId) {
                client.emit('sfu:error', {
                    message: 'Invalid participant information',
                });
                return {
                    success: false,
                    error: 'Invalid participant information',
                };
            }

            const transportInfo = await this.sfuClient.createTransport(
                data.roomId,
                peerId,
                data.isProducer,
            );

            // Parse the transport_data from SFU gRPC response
            let actualTransportData;
            if ((transportInfo as any).transport_data) {
                try {
                    const parsedData = JSON.parse(
                        (transportInfo as any).transport_data,
                    );
                    actualTransportData = parsedData.transport || parsedData;
                } catch (error) {
                    console.error(
                        '[Gateway] Failed to parse transport_data:',
                        error,
                    );
                    actualTransportData = transportInfo;
                }
            } else {
                actualTransportData = transportInfo;
            }
            client.emit('sfu:transport-created', {
                ...actualTransportData,
                isProducer: data.isProducer,
            });

            return { success: true };
        } catch (error) {
            client.emit('sfu:error', { message: error.message });
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('sfu:connect-transport')
    async handleConnectTransport(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            transportId: string;
            dtlsParameters: any;
            roomId?: string;
            peerId?: string;
        },
    ) {
        try {
            const peerId =
                data.peerId || this.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId || (await this.getRoomIdBySocketId(client.id));

            if (!peerId || !roomId) {
                client.emit('sfu:error', {
                    message: 'Invalid participant or room information',
                });
                return {
                    success: false,
                    error: 'Invalid participant or room information',
                };
            }

            await this.sfuClient.connectTransport(
                data.transportId,
                data.dtlsParameters,
                roomId,
                peerId,
            );

            client.emit('sfu:transport-connected', {
                transportId: data.transportId,
            });
            return { success: true };
        } catch (error) {
            client.emit('sfu:error', { message: error.message });
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('sfu:produce')
    async handleProduce(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            transportId: string;
            kind: string;
            rtpParameters: any;
            metadata: any;
            roomId?: string;
            peerId?: string;
        },
    ) {
        try {
            const peerId =
                data.peerId || this.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId || (await this.getRoomIdBySocketId(client.id));

            if (!peerId || !roomId) {
                client.emit('sfu:error', {
                    message: 'Invalid participant or room information',
                });
                return {
                    success: false,
                    error: 'Invalid participant or room information',
                };
            }

            // Ensure metadata is not undefined
            const safeMetadata = data.metadata || {};

            const result = await this.sfuClient.produce(
                data.transportId,
                data.kind,
                data.rtpParameters,
                safeMetadata,
                roomId,
                peerId,
            );

            // Parse producer_data if it's a string
            let producerData: any = result;
            if (typeof (result as any).producer_data === 'string') {
                try {
                    producerData = JSON.parse((result as any).producer_data);
                } catch (e) {
                    console.error(
                        '[Gateway] Failed to parse producer_data:',
                        e,
                    );
                }
            }

            const producerId =
                producerData.producer_id || producerData.producerId;
            const streamId = producerData.streamId || producerData.stream_id;

            // Check if this is a screen share stream
            const isScreenShare =
                (safeMetadata &&
                    (safeMetadata.isScreenShare === true ||
                        safeMetadata.type === 'screen' ||
                        safeMetadata.type === 'screen_audio')) ||
                streamId.includes('_screen');

            client.emit('sfu:producer-created', {
                producerId: producerId,
                streamId: streamId,
                kind: data.kind,
                appData: safeMetadata,
            });

            // Emit stream-added to all users in room (including sender)
            this.io.to(roomId).emit('sfu:stream-added', {
                streamId: streamId,
                publisherId: peerId,
                metadata: safeMetadata,
                rtpParameters: data.rtpParameters,
            });

            // If this is a screen share, emit special screen share event
            if (isScreenShare && data.kind === 'video') {
                this.io.to(roomId).emit('sfu:screen-share-started', {
                    peerId: peerId,
                    streamId: streamId,
                });
            }

            return { success: true };
        } catch (error) {
            client.emit('sfu:error', { message: error.message });
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('sfu:consume')
    async handleConsume(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            streamId: string;
            transportId: string;
            roomId?: string;
            peerId?: string;
        },
    ) {
        try {
            // Validate streamId before proceeding
            if (!data.streamId || data.streamId === 'undefined') {
                console.error(
                    '[Gateway] Invalid streamId in consume request:',
                    data.streamId,
                );
                client.emit('sfu:error', {
                    message: `Invalid streamId: ${data.streamId}. StreamId cannot be undefined or null.`,
                });
                return { success: false, error: 'Invalid streamId' };
            }

            if (!data.transportId) {
                console.error(
                    '[Gateway] Invalid transportId in consume request:',
                    data.transportId,
                );
                client.emit('sfu:error', {
                    message: `Invalid transportId: ${data.transportId}. TransportId cannot be undefined or null.`,
                });
                return { success: false, error: 'Invalid transportId' };
            }

            const peerId =
                data.peerId || this.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId || (await this.getRoomIdBySocketId(client.id));

            if (!peerId || !roomId) {
                console.error('[Gateway] Missing peerId or roomId for consume');
                return { success: false, error: 'Missing peerId or roomId' };
            }

            // Get participant data from room service
            let participant: any = null;
            try {
                participant = await this.roomClient.getParticipantByPeerId(
                    roomId,
                    peerId,
                );
            } catch (error) {
                console.log(
                    '[Gateway] Could not get participant data for consume:',
                    error,
                );
                participant = { peer_id: peerId, is_creator: false };
            }

            // For consume operation, we need to pass minimal RTP capabilities
            // The SFU service should have stored capabilities when they were set
            const rtpCapabilities = {}; // Will be populated by SFU service from stored data

            const consumerInfo = await this.sfuClient.consume(
                data.streamId,
                data.transportId,
                roomId,
                peerId,
                rtpCapabilities,
                participant,
            );

            // Parse the consumer data from the gRPC response
            let consumerData: any = {};
            try {
                if (consumerInfo && (consumerInfo as any).consumer_data) {
                    consumerData = JSON.parse(
                        (consumerInfo as any).consumer_data,
                    );
                } else {
                    console.error(
                        '[Gateway] No consumer_data in response:',
                        consumerInfo,
                    );
                    throw new Error('Invalid consumer response format');
                }
            } catch (parseError) {
                console.error(
                    '[Gateway] Failed to parse consumer data:',
                    parseError,
                );
                console.error('[Gateway] Raw consumer info:', consumerInfo);
                throw new Error('Failed to parse consumer response');
            }

            // Check if this is a non-priority stream (no consumer created)
            if (!consumerData.consumerId && consumerData.message) {
                client.emit('sfu:consumer-skipped', {
                    streamId: data.streamId,
                    message: consumerData.message,
                });
                return { success: true, skipped: true };
            }

            const consumerPayload = {
                consumerId: consumerData.consumerId,
                producerId: consumerData.producerId,
                kind: consumerData.kind,
                rtpParameters: consumerData.rtpParameters,
                streamId: data.streamId,
            };

            // Validate that all required fields are present
            const requiredFields = [
                'consumerId',
                'producerId',
                'kind',
                'rtpParameters',
            ];
            const missingFields = requiredFields.filter(
                (field) => !consumerPayload[field],
            );

            if (missingFields.length > 0) {
                console.error('[Gateway] Missing fields in consumer payload:', {
                    missingFields,
                    consumerPayload,
                    originalData: consumerData,
                });
                throw new Error(
                    `Missing required consumer fields: ${missingFields.join(', ')}`,
                );
            }

            client.emit('sfu:consumer-created', consumerPayload);

            return { success: true };
        } catch (error) {
            console.error('[Gateway] Error in handleConsume:', error);
            client.emit('sfu:error', { message: error.message });
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('sfu:resume-consumer')
    async handleResumeConsumer(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { consumerId: string; roomId?: string; participantId?: string },
    ) {
        try {
            const peerId =
                data.participantId || this.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId || (await this.getRoomIdBySocketId(client.id));

            if (!peerId || !roomId) {
                console.error(
                    '[Gateway] Missing peerId or roomId for resumeConsumer',
                );
                client.emit('sfu:error', {
                    message: 'Missing peerId or roomId',
                });
                return { success: false, error: 'Missing peerId or roomId' };
            }

            await this.sfuClient.resumeConsumer(
                data.consumerId,
                roomId,
                peerId,
            );

            client.emit('sfu:consumer-resumed', {
                consumerId: data.consumerId,
            });
            return { success: true };
        } catch (error) {
            client.emit('sfu:error', { message: error.message });
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('sfu:get-streams')
    async handleGetStreams(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { roomId: string },
    ) {
        try {
            const streams = await this.sfuClient.getStreams(data.roomId);

            // Transform snake_case fields from gRPC to camelCase for client
            const transformedStreams = (
                (streams as any).streams ||
                streams ||
                []
            ).map((stream: any) => {
                // Safely parse metadata
                let parsedMetadata = {};
                try {
                    if (stream.metadata) {
                        if (typeof stream.metadata === 'string') {
                            parsedMetadata = JSON.parse(stream.metadata);
                        } else {
                            parsedMetadata = stream.metadata;
                        }
                    }
                } catch (metadataError) {
                    console.error(
                        `[Gateway] Failed to parse metadata in getStreams for stream ${stream.stream_id || stream.streamId}:`,
                        metadataError,
                        'Raw metadata:',
                        stream.metadata,
                    );
                    // Default metadata if parsing fails
                    parsedMetadata = {
                        video: true,
                        audio: true,
                        type: 'webcam',
                    };
                }

                // Safely parse rtpParameters
                let parsedRtpParameters = {};
                try {
                    if (stream.rtpParameters) {
                        if (typeof stream.rtpParameters === 'string') {
                            parsedRtpParameters = JSON.parse(
                                stream.rtpParameters,
                            );
                        } else {
                            parsedRtpParameters = stream.rtpParameters;
                        }
                    } else if (stream.rtp_parameters) {
                        if (typeof stream.rtp_parameters === 'string') {
                            parsedRtpParameters = JSON.parse(
                                stream.rtp_parameters,
                            );
                        } else {
                            parsedRtpParameters = stream.rtp_parameters;
                        }
                    }
                } catch (rtpError) {
                    console.error(
                        `[Gateway] Failed to parse rtp_parameters in getStreams for stream ${stream.stream_id || stream.streamId}:`,
                        rtpError,
                    );
                    parsedRtpParameters = {};
                }

                // Handle both snake_case (from gRPC) and camelCase (from direct data)
                const transformedStream = {
                    streamId: stream.streamId || stream.stream_id,
                    publisherId: stream.publisherId || stream.publisher_id,
                    producerId: stream.producerId || stream.producer_id,
                    metadata: parsedMetadata,
                    rtpParameters: parsedRtpParameters,
                    roomId: stream.roomId || stream.room_id,
                };

                return transformedStream;
            });
            client.emit('sfu:streams', transformedStreams);
            return { success: true };
        } catch (error) {
            console.error('[API Gateway] Error getting streams:', error);
            client.emit('sfu:error', { message: error.message });
            return { success: false, error: error.message };
        }
    }

    // Handle speaking users with 500ms buffer logic
    @SubscribeMessage('sfu:my-speaking')
    async handleMySpeaking(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { roomId: string; peerId: string; bufferedAudio?: any },
    ) {
        console.log(`[Gateway] handleMySpeaking called with data:`, data);

        const roomId = data.roomId;
        const peerId = data.peerId;

        // Verify participant exists
        const participant = await this.getParticipantByPeerId(roomId, peerId);
        if (!participant) {
            console.error(
                `[Gateway] Participant ${peerId} not found in room ${roomId}`,
            );
            return;
        }

        // Verify the room exists for this socket
        const socketRoomId = await this.getRoomIdBySocketId(client.id);
        if (!socketRoomId || socketRoomId !== roomId) {
            console.error(
                `[Gateway] Socket room mismatch. Expected: ${roomId}, Got: ${socketRoomId}`,
            );
            return;
        }

        try {
            // Step 5: Emit to all clients in the room (excluding sender)
            client.to(roomId).emit('sfu:user-speaking', { peerId });

            console.log(
                `[Gateway] User ${peerId} pipeline ready - waiting for buffered audio + live stream`,
            );
        } catch (error) {
            console.error('[Gateway] Error handling speaking event:', error);

            // Check if it's a gRPC connection error (audio service down)
            if (
                error.message &&
                (error.message.includes('UNAVAILABLE') ||
                    error.message.includes('ECONNREFUSED') ||
                    error.message.includes('14 UNAVAILABLE'))
            ) {
                console.error('[Gateway] Audio service appears to be down');
                client.emit('sfu:audio-service-unavailable', {
                    peerId,
                    roomId,
                    message:
                        'Audio transcription service is currently unavailable',
                });
            } else {
                // Generic audio error
                client.emit('sfu:audio-pipeline-failed', {
                    peerId,
                    roomId,
                    message: 'Failed to initialize audio pipeline',
                });
            }
        }
    }

    // Handle user stop speaking
    @SubscribeMessage('sfu:my-stop-speaking')
    async handleMyStopSpeaking(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { roomId: string; peerId: string },
    ) {
        console.log(`[Gateway] handleMyStopSpeaking called with data:`, data);

        const roomId = data.roomId;
        const peerId = data.peerId;

        // Verify participant exists
        const participant = await this.getParticipantByPeerId(roomId, peerId);
        if (!participant) {
            console.error(
                `[Gateway] Participant ${peerId} not found in room ${roomId}`,
            );
            return;
        }

        // Verify the room exists for this socket
        const socketRoomId = await this.getRoomIdBySocketId(client.id);
        if (!socketRoomId || socketRoomId !== roomId) {
            console.error(
                `[Gateway] Socket room mismatch. Expected: ${roomId}, Got: ${socketRoomId}`,
            );
            return;
        }

        try {
            // Notify SFU service that user stopped speaking
            // await this.sfuClient.handleStopSpeaking(roomId, peerId);

            // Notify all clients in the room (excluding sender) that user stopped speaking
            client.to(roomId).emit('sfu:user-stopped-speaking', { peerId });

            console.log(
                `[Gateway] User ${peerId} stopped speaking in room ${roomId}`,
            );
        } catch (error) {
            console.error(
                '[Gateway] Error handling stop speaking event:',
                error,
            );
        }
    }

    // NEW AUDIO BUFFER PROCESSING
    @SubscribeMessage('audio:buffer')
    async handleAudioBuffer(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            userId: string;
            roomId: string;
            timestamp: number;
            buffer: number[];
            duration: number;
            sampleRate: number;
            channels: number;
            isFinal?: boolean; // Indicates if this is the final chunk or periodic chunk
        },
    ) {
        const isFinal = data.isFinal !== false; // Default to true for backward compatibility
        const chunkType = isFinal ? 'final' : 'periodic';

        console.log(
            `[Gateway] Received ${chunkType} audio buffer from ${data.userId} - ${data.duration}ms, ${data.buffer.length} bytes`,
        );

        // Validate data
        if (
            !data.userId ||
            !data.roomId ||
            !data.buffer ||
            data.buffer.length === 0
        ) {
            console.error('[Gateway] Invalid audio buffer data:', {
                hasUserId: !!data.userId,
                hasRoomId: !!data.roomId,
                hasBuffer: !!data.buffer,
                bufferLength: data.buffer?.length || 0,
            });
            return;
        }

        // Check buffer size limit to prevent memory issues
        // 16kHz * 2 bytes/sample * 15 seconds = 480,000 bytes max
        const MAX_BUFFER_SIZE = 480000; // ~15 seconds at 16kHz (match client limit)
        if (data.buffer.length > MAX_BUFFER_SIZE) {
            console.error(
                `[Gateway] Audio buffer too large: ${data.buffer.length} bytes (max: ${MAX_BUFFER_SIZE})`,
            );
            client.emit('audio:error', {
                userId: data.userId,
                roomId: data.roomId,
                message: 'Audio buffer too large',
                maxSize: MAX_BUFFER_SIZE,
                receivedSize: data.buffer.length,
            });
            return;
        }

        console.log(
            `[Gateway] Validating participant ${data.userId} in room ${data.roomId}`,
        );

        // Verify participant exists in room
        let participant = await this.getParticipantByPeerId(
            data.roomId,
            data.userId,
        );

        // If room service fails, try to validate using local mappings
        if (!participant) {
            console.error(
                `[Gateway] Participant ${data.userId} not found in room ${data.roomId}`,
            );
            return;
        } else {
            console.log(
                `[Gateway] Participant ${data.userId} found in room ${data.roomId} via room service`,
            );
        }

        try {
            // Convert array back to Uint8Array for audio service with safety check
            let audioBuffer: Uint8Array;
            try {
                audioBuffer = new Uint8Array(data.buffer);
            } catch (conversionError) {
                console.error(
                    '[Gateway] Failed to convert buffer to Uint8Array:',
                    conversionError,
                );
                client.emit('audio:error', {
                    userId: data.userId,
                    roomId: data.roomId,
                    message: 'Failed to process audio buffer format',
                    error: conversionError.message,
                });
                return;
            }

            console.log(
                `[Gateway] Calling audio service processAudioBuffer for ${data.userId}`,
            );

            // Send to Audio Service for processing
            const result = this.audioService.processAudioBuffer({
                userId: data.userId,
                roomId: data.roomId,
                timestamp: data.timestamp,
                buffer: audioBuffer,
                duration: data.duration,
                sampleRate: data.sampleRate || 16000,
                channels: data.channels || 1,
            });

            console.log(
                `[Gateway] Audio buffer processed for ${data.userId}`,
                result,
            );
        } catch (error) {
            console.error('[Gateway] Error processing audio buffer:', error);

            // Notify client about the error
            client.emit('audio:error', {
                userId: data.userId,
                roomId: data.roomId,
                message: 'Failed to process audio buffer',
                error: error.message,
            });
        }
    }

    @SubscribeMessage('audio:chunk')
    async handleAudioChunk(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            userId: string;
            roomId: string;
            timestamp: number;
            buffer: number[] | ArrayBuffer;
            duration: number;
        },
    ) {
        try {
            const { userId, roomId, timestamp, buffer, duration } = data;

            // Validate audio chunk data
            if (!this.validateAudioChunk(data)) {
                console.error(
                    `[Gateway] Invalid audio chunk from ${client.id}`,
                );
                client.emit('audio:error', {
                    message: 'Invalid audio chunk data',
                });
                return;
            }

            // Verify user is authorized to send audio for this room
            const isAuthorized = await this.verifyUserInRoom(
                client.id,
                userId,
                roomId,
            );
            if (!isAuthorized) {
                console.error(
                    `[Gateway] Unauthorized audio chunk from ${userId} in room ${roomId}`,
                );
                client.emit('audio:error', {
                    message: 'Unauthorized audio access',
                });
                return;
            }

            console.log(
                `[Gateway] Processing audio chunk: ${Array.isArray(buffer) ? buffer.length : buffer.byteLength} bytes from ${userId}`,
            );

            // Convert array to Uint8Array for gRPC if needed
            let audioBuffer: Uint8Array;
            if (Array.isArray(buffer)) {
                audioBuffer = new Uint8Array(buffer);
            } else {
                audioBuffer = new Uint8Array(buffer);
            }

            // Forward to Audio Service via gRPC
            try {
                const response = await this.audioService.processAudioChunk({
                    roomId: roomId,
                    userId: userId,
                    timestamp: timestamp,
                    audioBuffer: audioBuffer,
                    duration: duration,
                });

                // Send acknowledgment to client
                client.emit('audio:chunk-received', {
                    timestamp,
                    status: response.success ? 'processing' : 'failed',
                    message: response.message,
                });

                console.log(`[Gateway] Audio chunk processed for ${userId}`);
            } catch (error) {
                console.error(
                    `[Gateway] Failed to forward audio chunk to service:`,
                    error,
                );
                client.emit('audio:error', {
                    message: 'Failed to process audio chunk',
                    timestamp: timestamp,
                });
            }
        } catch (error) {
            console.error(`[Gateway] Error in handleAudioChunk:`, error);
            client.emit('audio:error', {
                message: 'Internal server error',
                timestamp: data.timestamp,
            });
        }
    }

    // VALIDATE AUDIO CHUNK
    private validateAudioChunk(data: {
        userId: string;
        roomId: string;
        timestamp: number;
        buffer: number[] | ArrayBuffer;
        duration: number;
    }): boolean {
        if (!data.userId || typeof data.userId !== 'string') {
            console.warn('[Gateway] Invalid userId in audio chunk');
            return false;
        }

        if (!data.roomId || typeof data.roomId !== 'string') {
            console.warn('[Gateway] Invalid roomId in audio chunk');
            return false;
        }

        if (!data.timestamp || typeof data.timestamp !== 'number') {
            console.warn('[Gateway] Invalid timestamp in audio chunk');
            return false;
        }

        // Handle both array and ArrayBuffer formats
        let bufferSize = 0;
        if (Array.isArray(data.buffer)) {
            bufferSize = data.buffer.length;
        } else if (data.buffer instanceof ArrayBuffer) {
            bufferSize = data.buffer.byteLength;
        } else {
            console.warn('[Gateway] Invalid buffer format in audio chunk');
            return false;
        }

        if (
            !data.duration ||
            typeof data.duration !== 'number' ||
            data.duration <= 0
        ) {
            console.warn('[Gateway] Invalid duration in audio chunk');
            return false;
        }

        // Check reasonable audio buffer size (100ms to 3s of 16kHz 16-bit mono)
        const minSize = 16000 * 2 * 0.1; // 100ms = 3,200 bytes
        const maxSize = 16000 * 2 * 3; // 3s = 96,000 bytes

        if (bufferSize < minSize || bufferSize > maxSize) {
            console.warn(
                `[Gateway] Audio buffer size out of range: ${bufferSize} bytes (min: ${minSize}, max: ${maxSize})`,
            );
            return false;
        }

        return true;
    }

    // VERIFY USER IN ROOM
    private async verifyUserInRoom(
        socketId: string,
        userId: string,
        roomId: string,
    ): Promise<boolean> {
        try {
            // Check if socket is mapped to this user
            const mappedPeerId = this.connectionMap.get(socketId);
            if (mappedPeerId !== userId) {
                console.warn(
                    `[Gateway] Socket ${socketId} not mapped to user ${userId}`,
                );
                return false;
            }

            // Verify user is participant in room
            const participant = await this.roomClient.getParticipantByPeerId(
                roomId,
                userId,
            );
            if (!participant) {
                console.warn(
                    `[Gateway] User ${userId} not found in room ${roomId}`,
                );
                return false;
            }

            // Check if participant's socket matches
            if (participant.socket_id !== socketId) {
                console.warn(
                    `[Gateway] Socket mismatch for user ${userId} in room ${roomId}`,
                );
                return false;
            }

            return true;
        } catch (error) {
            console.error(`[Gateway] Error verifying user in room:`, error);
            return false;
        }
    }

    // HELPER METHODS
    private storeParticipantMapping(
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
            console.log(`[Gateway] Cached participant data for ${peerId}`);
        }
    }

    private cleanupParticipantMapping(socketId: string): void {
        const peerId = this.connectionMap.get(socketId);
        if (peerId) {
            this.connectionMap.delete(socketId);
            this.participantSocketMap.delete(peerId);
            this.roomParticipantMap.delete(peerId);
            this.participantCache.delete(peerId);
        }
    }

    private getParticipantBySocketId(socketId: string): string | null {
        return this.connectionMap.get(socketId) || null;
    }

    private async getRoomIdBySocketId(
        socketId: string,
    ): Promise<string | null> {
        const peerId = this.connectionMap.get(socketId);
        if (peerId) {
            const roomId = this.roomParticipantMap.get(peerId);
            return roomId || null;
        }
        return null;
    }

    private async getParticipantByPeerId(
        roomId: string,
        peerId: string,
    ): Promise<any> {
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
                console.log(
                    `[Gateway] Participant ${peerId} not found via room service`,
                );
            }

            return participant;
        } catch (error) {
            console.error(
                `[Gateway] Error getting participant ${peerId} in room ${roomId}:`,
                error,
            );
            return null;
        }
    }

    private async getAllRoomsWithParticipants(): Promise<Map<string, any[]>> {
        try {
            // This is a simplified version - you might need to implement actual room scanning
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
            console.error('[Gateway] Error getting all rooms:', error);
            return new Map();
        }
    }

    // ==================== CHAT HANDLERS ====================

    @SubscribeMessage('chat:join')
    async handleChatJoin(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { roomId: string; userName: string },
    ) {
        return this.chatHandler.handleJoinRoom(client, data);
    }

    @SubscribeMessage('chat:leave')
    async handleChatLeave(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { roomId: string },
    ) {
        return this.chatHandler.handleLeaveRoom(client, data);
    }

    @SubscribeMessage('chat:message')
    async handleChatMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            message: {
                sender: string;
                senderName: string;
                text: string;
                replyTo?: {
                    messageId: string;
                    senderName: string;
                    text: string;
                    isFile?: boolean;
                };
            };
        },
    ) {
        return this.chatHandler.handleSendMessage(client, data);
    }

    @SubscribeMessage('chat:file')
    async handleChatFile(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            message: {
                sender: string;
                senderName: string;
                text: string;
                fileUrl: string;
                fileName: string;
                fileType: string;
                fileSize: number;
                isImage: boolean;
                replyTo?: {
                    messageId: string;
                    senderName: string;
                    text: string;
                    isFile?: boolean;
                };
            };
        },
    ) {
        return this.chatHandler.handleSendFileMessage(client, data);
    }

    // Helper methods for parsing stream data
    private parseStreamMetadata(metadata: any): any {
        try {
            if (!metadata) return { video: true, audio: true, type: 'webcam' };
            if (typeof metadata === 'string') {
                return JSON.parse(metadata);
            }
            return metadata;
        } catch (error) {
            console.error('Failed to parse stream metadata:', error);
            return { video: true, audio: true, type: 'webcam' };
        }
    }

    private parseStreamRtpParameters(rtpParameters: any): any {
        try {
            if (!rtpParameters) return {};
            if (typeof rtpParameters === 'string') {
                return JSON.parse(rtpParameters);
            }
            return rtpParameters;
        } catch (error) {
            console.error('Failed to parse stream RTP parameters:', error);
            return {};
        }
    }
}
