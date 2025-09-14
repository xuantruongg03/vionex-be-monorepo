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
import { ChatBotClientService } from './clients/chatbot.client';
import { InteractionClientService } from './clients/interaction.client';
import { RoomClientService } from './clients/room.client';
import { SfuClientService } from './clients/sfu.client';
import { ChatHandler } from './handlers/chat.handler';
import { QuizHandler } from './handlers/quiz.handler';
import { TranslationHandler } from './handlers/translation.handler';
import { VotingHandler } from './handlers/voting.handler';
import { WhiteboardHandler } from './handlers/whiteboard.handler';
import { GatewayHelperService } from './helpers/gateway.helper';
import { Participant } from './interfaces/interface';
import { HttpBroadcastService } from './services/http-broadcast.service';
import { StreamService } from './services/stream.service';
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

    constructor(
        private readonly eventService: WebSocketEventService,
        private readonly roomClient: RoomClientService,
        private readonly httpBroadcastService: HttpBroadcastService,
        private readonly sfuClient: SfuClientService,
        private readonly interactionClient: InteractionClientService,
        private readonly audioService: AudioClientService,
        private readonly chatHandler: ChatHandler,
        private readonly translationHandler: TranslationHandler,
        private readonly votingHandler: VotingHandler,
        private readonly quizHandler: QuizHandler,
        private readonly whiteboardHandler: WhiteboardHandler,
        private readonly helperService: GatewayHelperService,
        private readonly streamService: StreamService,
        private readonly chatbotClient: ChatBotClientService,
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
        let peerId = this.helperService.getParticipantBySocketId(client.id);
        let roomId = peerId
            ? this.helperService.getRoomParticipantMap().get(peerId)
            : null;

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
                            await this.helperService.getAllRoomsWithParticipants();

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
                    reason: 'voluntary', // User left voluntarily (disconnect)
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

            // Auto-destroy translation cabins
            try {
                await this.autoDestroyCabins(peerId, roomId);
            } catch (error) {
                console.error(
                    '[BACKEND] Error auto-destroying translation cabins:',
                    error,
                );
            }
        }

        // Clean up connection mapping
        this.helperService.cleanupParticipantMapping(client.id);
    }

    /**
     * Auto-destroy translation cabins when user disconnects
     */
    private async autoDestroyCabins(userId: string, roomId: string) {
        try {
            // Get room participants from room service
            const roomData = await this.roomClient.getRoom(roomId);
            if (!roomData.data?.participants) return;

            const allParticipants = roomData.data.participants.map(
                (p: any) => p.peer_id,
            );
            const allCabins: any[] = [];

            // Collect cabins from all participants to find all cabins in room
            for (const participantId of allParticipants) {
                try {
                    const cabinsResult =
                        await this.sfuClient.listTranslationCabin(
                            roomId,
                            participantId,
                        );
                    if (cabinsResult.success && cabinsResult.cabins) {
                        cabinsResult.cabins.forEach((cabin) => {
                            allCabins.push({
                                ...cabin,
                                queriedUserId: participantId, // track who we queried to get this cabin
                            });
                        });
                    }
                } catch (err) {
                    console.log('[Gateway] Error listing cabins for participant:', err);
                }
            }

            // Remove duplicates based on cabin signature
            const uniqueCabins = allCabins.filter(
                (cabin, index, arr) =>
                    arr.findIndex(
                        (c) =>
                            c.targetUserId === cabin.targetUserId &&
                            c.sourceLanguage === cabin.sourceLanguage &&
                            c.targetLanguage === cabin.targetLanguage,
                    ) === index,
            );

            // Process each cabin based on role
            for (const cabin of uniqueCabins) {
                if (cabin.targetUserId === userId) {
                    // User disconnecting is TARGET of cabin -> destroy unconditionally
                    const destroyData = {
                        roomId,
                        sourceUserId: cabin.queriedUserId, // who created this cabin
                        targetUserId: cabin.targetUserId,
                        sourceLanguage: cabin.sourceLanguage,
                        targetLanguage: cabin.targetLanguage,
                    };
                    await this.translationHandler.handleDestroyTranslationCabin(
                        null,
                        destroyData,
                    );
                } else if (cabin.queriedUserId === userId) {
                    // User disconnecting CREATED this cabin -> check consumers
                    if (!allParticipants.includes(cabin.targetUserId)) {
                        // Target not in room -> no consumers -> destroy
                        const destroyData = {
                            roomId,
                            sourceUserId: userId,
                            targetUserId: cabin.targetUserId,
                            sourceLanguage: cabin.sourceLanguage,
                            targetLanguage: cabin.targetLanguage,
                        };
                        await this.translationHandler.handleDestroyTranslationCabin(
                            null,
                            destroyData,
                        );
                    }
                }
            }
        } catch (error) {
            console.error('[Gateway] Error in auto destroy cabins:', error);
        }
    }

    @SubscribeMessage('sfu:join')
    async handleJoin(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            peerId: string;
            password?: string;
            userInfo: any;
        },
    ) {
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

            this.helperService.storeParticipantMapping(
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
            user_info: data.userInfo, // Add user info to participant
        };
        try {
            await this.roomClient.setParticipant(data.roomId, participant);

            // Track the connection mapping for disconnect cleanup - IMPORTANT
            this.helperService.storeParticipantMapping(
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
                    userInfo: participant.user_info, // Add user info to broadcast
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
                            userInfo: p.user_info, // Add user info to users list
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
                data.peerId ||
                this.helperService.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId ||
                (await this.helperService.getRoomIdBySocketId(client.id));

            console.log(`[Gateway] Setting RTP capabilities for peer ${peerId} in room ${roomId}`);
            console.log(`[Gateway] RTP capabilities codecs count: ${data.rtpCapabilities?.codecs?.length || 0}`);

            if (!peerId || !roomId) {
                console.error(`[Gateway] Invalid participant or room info - peerId: ${peerId}, roomId: ${roomId}`);
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

            // Store RTP capabilities in room service for persistence and retrieval
            try {
                console.log(`[Gateway] Storing RTP capabilities in room service for peer ${peerId}`);
                const rtpResult = await this.roomClient.updateParticipantRtpCapabilities(
                    peerId,
                    data.rtpCapabilities,
                );
                
                if (rtpResult.success) {
                    console.log(`[Gateway] Successfully stored RTP capabilities for peer ${peerId}`);
                } else {
                    console.warn('[Gateway] Failed to store RTP capabilities in room service:', rtpResult.error);
                }
            } catch (error) {
                console.warn('[Gateway] Error storing RTP capabilities in room service:', error);
                // Don't fail the whole operation for this
            }

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
                data.peerId ||
                this.helperService.getParticipantBySocketId(client.id);

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
                data.peerId ||
                this.helperService.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId ||
                (await this.helperService.getRoomIdBySocketId(client.id));

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
                data.peerId ||
                this.helperService.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId ||
                (await this.helperService.getRoomIdBySocketId(client.id));

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
                data.peerId ||
                this.helperService.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId ||
                (await this.helperService.getRoomIdBySocketId(client.id));

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
                metadata: consumerData.metadata, // Include metadata for translation streams
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
                data.participantId ||
                this.helperService.getParticipantBySocketId(client.id);
            const roomId =
                data.roomId ||
                (await this.helperService.getRoomIdBySocketId(client.id));

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
        const participant = await this.helperService.getParticipantByPeerId(
            roomId,
            peerId,
        );
        if (!participant) {
            console.error(
                `[Gateway] Participant ${peerId} not found in room ${roomId}`,
            );
            return;
        }

        // Verify the room exists for this socket
        const socketRoomId = await this.helperService.getRoomIdBySocketId(
            client.id,
        );
        if (!socketRoomId || socketRoomId !== roomId) {
            console.error(
                `[Gateway] Socket room mismatch. Expected: ${roomId}, Got: ${socketRoomId}`,
            );
            return;
        }

        try {
            // ENHANCED: Call SFU to handle speaking priority logic instead of just emitting event
            // This replaces the old simple emit logic with full priority management
            try {
                const speakingResult = await this.sfuClient.handleSpeaking(
                    roomId,
                    peerId,
                    0, // port not used for priority logic
                );
                console.log(`[Gateway] SFU speaking result:`, speakingResult);

                // ENHANCED: Check if speaking user needs to be prioritized for consumption
                // This triggers dynamic stream consumption based on voice activity
                if (
                    speakingResult &&
                    (speakingResult as any).status === 'success'
                ) {
                    await this.handleSpeakingUserPriority(roomId, peerId);
                }
            } catch (sfuError) {
                console.error(`[Gateway] SFU speaking error:`, sfuError);
                // Continue with basic emit if SFU fails
            }

            // Step 5: Emit to all clients in the room (excluding sender) - KEPT ORIGINAL LOGIC
            client.to(roomId).emit('sfu:user-speaking', { peerId });

            console.log(
                `[Gateway] User ${peerId} speaking handled with priority check`,
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
        const participant = await this.helperService.getParticipantByPeerId(
            roomId,
            peerId,
        );
        if (!participant) {
            console.error(
                `[Gateway] Participant ${peerId} not found in room ${roomId}`,
            );
            return;
        }

        // Verify the room exists for this socket
        const socketRoomId = await this.helperService.getRoomIdBySocketId(
            client.id,
        );
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
        let participant = await this.helperService.getParticipantByPeerId(
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
        return await this.helperService.verifyUserInRoom(
            socketId,
            userId,
            roomId,
        );
    }

    /**
     * ENHANCED: Handle priority streaming for speaking user
     * This method implements the voice activity detection-based stream prioritization
     * When a user speaks, we ensure their stream is consumed by other participants
     */
    private async handleSpeakingUserPriority(
        roomId: string,
        speakingPeerId: string,
    ) {
        try {
            console.log(
                `[Gateway] Handling speaking priority for ${speakingPeerId} in room ${roomId}`,
            );

            // Step 1: Get all participants in the room (except the speaking user)
            const roomParticipants =
                await this.getAllParticipantsInRoom(roomId);
            const otherParticipants = roomParticipants.filter(
                (p) => p.peer_id !== speakingPeerId,
            );

            // Step 2: Get streams from the speaking user that need to be prioritized
            const speakingUserStreams = await this.getSpeakingUserStreams(
                roomId,
                speakingPeerId,
            );

            if (speakingUserStreams.length === 0) {
                console.log(
                    `[Gateway] No streams found for speaking user ${speakingPeerId}`,
                );
                return;
            }

            // Step 3: For each other participant, ensure they consume the speaking user's streams
            for (const participant of otherParticipants) {
                const socketId = this.helperService
                    .getParticipantSocketMap()
                    .get(participant.peer_id);
                if (!socketId) continue;

                const socket = this.io.sockets.sockets.get(socketId);
                if (!socket) continue;

                // Step 4: Trigger stream consumption for speaking user
                for (const stream of speakingUserStreams) {
                    // Emit stream-added event to trigger consumption
                    socket.emit('sfu:stream-added', {
                        streamId: stream.streamId,
                        stream_id: stream.streamId,
                        publisherId: speakingPeerId,
                        publisher_id: speakingPeerId,
                        metadata: stream.metadata || {
                            isFromSpeaking: true, // Mark as priority from speaking
                            priority: true,
                        },
                        rtpParameters: stream.rtpParameters,
                    });

                    console.log(
                        `[Gateway] Sent priority stream ${stream.streamId} to ${participant.peer_id}`,
                    );
                }
            }

            console.log(
                `[Gateway] Successfully handled speaking priority for ${speakingPeerId}`,
            );
        } catch (error) {
            console.error(`[Gateway] Error handling speaking priority:`, error);
        }
    }

    /**
     * ENHANCED: Get all participants in a room
     * Reuses existing logic from room service
     */
    private async getAllParticipantsInRoom(roomId: string): Promise<any[]> {
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
            console.error(
                `[Gateway] Error getting participants for room ${roomId}:`,
                error,
            );
            return [];
        }
    }

    /**
     * ENHANCED: Get streams from speaking user that should be prioritized
     * This method filters for audio/video streams that need priority consumption
     */
    private async getSpeakingUserStreams(
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
            console.error(
                `[Gateway] Error getting speaking user streams:`,
                error,
            );
            return [];
        }
    }

    @SubscribeMessage('sfu:unpublish')
    async handleUnpublish(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { streamId: string; roomId?: string },
    ) {
        try {
            // Get participant info from socket mapping
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            const roomId =
                data.roomId ||
                (await this.helperService.getRoomIdBySocketId(client.id));

            if (!peerId || !roomId) {
                client.emit('sfu:error', {
                    message: 'Invalid participant or room information',
                    code: 'INVALID_CONTEXT',
                });
                return {
                    success: false,
                    error: 'Invalid participant or room information',
                };
            }

            console.log(
                `[Gateway] Handling unpublish for stream ${data.streamId} from ${peerId} in room ${roomId}`,
            );

            // Verify stream ownership for security
            const isOwner = await this.streamService.verifyStreamOwnership(
                data.streamId,
                peerId,
                roomId,
            );

            if (!isOwner) {
                console.warn(
                    `[Gateway] Unauthorized unpublish attempt: ${peerId} trying to unpublish ${data.streamId}`,
                );
                client.emit('sfu:error', {
                    message: 'You can only unpublish your own streams',
                    code: 'UNAUTHORIZED_UNPUBLISH',
                });
                return { success: false, error: 'Unauthorized' };
            }

            // Unpublish the stream
            const result = await this.streamService.unpublishStream({
                streamId: data.streamId,
                roomId: roomId,
                participantId: peerId,
            });

            if (result.success) {
                // Send success confirmation to the requesting client
                client.emit('sfu:unpublish-success', {
                    streamId: data.streamId,
                    message: result.message,
                });

                console.log(
                    `[Gateway] Successfully unpublished stream ${data.streamId} for ${peerId}`,
                );
            } else {
                // Send error to the requesting client
                client.emit('sfu:error', {
                    message: result.message,
                    code: 'UNPUBLISH_FAILED',
                });

                console.error(
                    `[Gateway] Failed to unpublish stream ${data.streamId}: ${result.message}`,
                );
            }

            return result;
        } catch (error) {
            console.error('[Gateway] Error in handleUnpublish:', error);
            client.emit('sfu:error', {
                message: 'Internal server error during unpublish',
                code: 'INTERNAL_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    @SubscribeMessage('sfu:update-stream-metadata')
    async handleUpdateStreamMetadata(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            streamId: string;
            metadata: any;
            roomId?: string;
        },
    ) {
        try {
            // Get participant info from socket mapping
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            const roomId =
                data.roomId ||
                (await this.helperService.getRoomIdBySocketId(client.id));

            if (!peerId || !roomId) {
                client.emit('sfu:error', {
                    message: 'Invalid participant or room information',
                    code: 'INVALID_CONTEXT',
                });
                return {
                    success: false,
                    error: 'Invalid participant or room information',
                };
            }

            // Call SFU service to update stream metadata
            await this.sfuClient.updateStream({
                stream_id: data.streamId,
                participant_id: peerId,
                metadata: JSON.stringify(data.metadata),
                room_id: roomId,
            });

            // Broadcast the metadata update to all clients in the room
            this.io.to(roomId).emit('sfu:stream-metadata-updated', {
                streamId: data.streamId,
                publisherId: peerId,
                metadata: data.metadata,
                roomId: roomId,
            });

            // Confirm to the sender
            client.emit('sfu:stream-metadata-updated-ack', {
                success: true,
                streamId: data.streamId,
                metadata: data.metadata,
            });

            return {
                success: true,
                message: 'Stream metadata updated successfully',
            };
        } catch (error) {
            console.error('[Gateway] Error updating stream metadata:', error);
            client.emit('sfu:error', {
                message: error.message || 'Failed to update stream metadata',
                code: 'UPDATE_STREAM_METADATA_FAILED',
            });
            return {
                success: false,
                error: error.message || 'Failed to update stream metadata',
            };
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

    // ==================== TRANSLATION CABIN HANDLERS ====================

    @SubscribeMessage('translation:create')
    async handleCreateTranslationCabin(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            sourceUserId: string;
            targetUserId: string;
            sourceLanguage: string;
            targetLanguage: string;
        },
    ) {
        return this.translationHandler.handleCreateTranslationCabin(
            client,
            data,
        );
    }

    @SubscribeMessage('translation:destroy')
    async handleDestroyTranslationCabin(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            sourceUserId: string;
            targetUserId: string;
            sourceLanguage: string;
            targetLanguage: string;
        },
    ) {
        return this.translationHandler.handleDestroyTranslationCabin(
            client,
            data,
        );
    }

    @SubscribeMessage('translation:list')
    async handleListTranslationCabins(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            userId: string;
        },
    ) {
        return this.translationHandler.handleListTranslationCabins(
            client,
            data,
        );
    }

    // ==================== PIN/UNPIN USER HANDLERS ====================

    @SubscribeMessage('sfu:pin-user')
    async handlePinUser(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            pinnedPeerId: string;
            transportId: string;
        },
    ) {
        try {
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            if (!peerId) {
                client.emit('sfu:pin-user-response', {
                    success: false,
                    message: 'User not authenticated',
                });
                return;
            }

            console.log(
                `[Gateway] Pin user request from ${peerId} to pin ${data.pinnedPeerId}`,
            );

            // Get participant data for RTP capabilities
            const participant = this.helperService
                .getParticipantCache()
                .get(peerId);
            const rtpCapabilities = participant?.rtpCapabilities || {};

            const result = (await this.sfuClient.pinUser(
                data.roomId,
                peerId, // pinnerPeerId
                data.pinnedPeerId, // pinnedPeerId
                data.transportId,
                rtpCapabilities,
            )) as any;

            const parsedResult =
                typeof result.pin_data === 'string'
                    ? JSON.parse(result.pin_data)
                    : result.pin_data;

            // Emit response to pinner
            client.emit('sfu:pin-user-response', {
                success: parsedResult.success,
                message: parsedResult.message,
                consumersCreated: parsedResult.consumersCreated || [],
                alreadyPriority: parsedResult.alreadyPriority,
                existingConsumer: parsedResult.existingConsumer,
            });

            // Broadcast pin event to room (for UI updates)
            client.to(data.roomId).emit('sfu:user-pinned', {
                pinnerPeerId: peerId,
                pinnedPeerId: data.pinnedPeerId,
                roomId: data.roomId,
            });

            console.log(
                `[Gateway] Pin user successful: ${peerId} pinned ${data.pinnedPeerId}`,
            );
        } catch (error) {
            console.error(`[Gateway] Error pinning user:`, error);
            client.emit('sfu:pin-user-response', {
                success: false,
                message: error.message || 'Failed to pin user',
            });
        }
    }

    @SubscribeMessage('sfu:unpin-user')
    async handleUnpinUser(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            unpinnedPeerId: string;
        },
    ) {
        try {
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            if (!peerId) {
                client.emit('sfu:unpin-user-response', {
                    success: false,
                    message: 'User not authenticated',
                });
                return;
            }

            console.log(
                `[Gateway] Unpin user request from ${peerId} to unpin ${data.unpinnedPeerId}`,
            );

            const result = (await this.sfuClient.unpinUser(
                data.roomId,
                peerId, // unpinnerPeerId
                data.unpinnedPeerId, // unpinnedPeerId
            )) as any;

            const parsedResult =
                typeof result.unpin_data === 'string'
                    ? JSON.parse(result.unpin_data)
                    : result.unpin_data;

            // Emit response to unpinner
            client.emit('sfu:unpin-user-response', {
                success: parsedResult.success,
                message: parsedResult.message,
                consumersRemoved: parsedResult.consumersRemoved || [],
                stillInPriority: parsedResult.stillInPriority,
            });

            // Broadcast unpin event to room (for UI updates)
            client.to(data.roomId).emit('sfu:user-unpinned', {
                unpinnerPeerId: peerId,
                unpinnedPeerId: data.unpinnedPeerId,
                roomId: data.roomId,
            });

            console.log(
                `[Gateway] Unpin user successful: ${peerId} unpinned ${data.unpinnedPeerId}`,
            );
        } catch (error) {
            console.error(`[Gateway] Error unpinning user:`, error);
            client.emit('sfu:unpin-user-response', {
                success: false,
                message: error.message || 'Failed to unpin user',
            });
        }
    }

    // ==================== VOTING HANDLERS ====================

    @SubscribeMessage('sfu:create-vote')
    async handleCreateVote(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            question: string;
            options: { id: string; text: string }[];
            creatorId: string;
        },
    ) {
        return this.votingHandler.handleCreateVote(client, data);
    }

    @SubscribeMessage('sfu:submit-vote')
    async handleSubmitVote(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            voteId: string;
            optionId: string;
            voterId: string;
        },
    ) {
        return this.votingHandler.handleSubmitVote(client, data);
    }

    @SubscribeMessage('sfu:get-vote-results')
    async handleGetVoteResults(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            voteId: string;
        },
    ) {
        return this.votingHandler.handleGetVoteResults(client, data);
    }

    @SubscribeMessage('sfu:end-vote')
    async handleEndVote(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            voteId: string;
            creatorId: string;
        },
    ) {
        return this.votingHandler.handleEndVote(client, data);
    }

    @SubscribeMessage('sfu:get-active-vote')
    async handleGetActiveVote(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
        },
    ) {
        return this.votingHandler.handleGetActiveVote(client, data);
    }

    // ==================== QUIZ HANDLERS ====================

    @SubscribeMessage('quiz:create')
    async handleCreateQuiz(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            title: string;
            questions: any[];
            creatorId: string;
        },
    ) {
        return this.quizHandler.handleCreateQuiz(client, data);
    }

    @SubscribeMessage('quiz:submit')
    async handleSubmitQuiz(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            quizId: string;
            participantId: string;
            answers: Array<{
                questionId: string;
                selectedOptions: string[];
                essayAnswer: string;
            }>;
        },
    ) {
        return this.quizHandler.handleSubmitQuiz(client, data);
    }

    @SubscribeMessage('quiz:end')
    async handleEndQuiz(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            quizId: string;
            creatorId: string;
        },
    ) {
        return this.quizHandler.handleEndQuiz(client, data);
    }

    @SubscribeMessage('quiz:get-active')
    async handleGetActiveQuiz(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            requesterId: string;
        },
    ) {
        return this.quizHandler.handleGetActiveQuiz(client, data);
    }

    // ==================== BEHAVIOR MONITORING HANDLERS ====================

    @SubscribeMessage('sfu:send-behavior-logs')
    async handleSendBehaviorLogs(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            peerId: string;
            roomId: string;
            behaviorLogs: Array<{
                type: string;
                value: any;
                time: Date | string | number;
            }>;
        },
    ) {
        try {
            console.log(
                `[Gateway] Received behavior logs from ${data.peerId} in room ${data.roomId}`,
            );

            // Validate input
            if (
                !data.peerId ||
                !data.roomId ||
                !Array.isArray(data.behaviorLogs)
            ) {
                client.emit('sfu:behavior-logs-error', {
                    message: 'Invalid behavior logs data',
                });
                return;
            }

            // Forward to interaction service for storage
            await this.interactionClient.storeBehaviorLogs(
                data.roomId,
                data.peerId,
                data.behaviorLogs,
            );

            // For now, just acknowledge receipt
            client.emit('sfu:behavior-logs-received', {
                success: true,
                logsCount: data.behaviorLogs.length,
            });

            console.log(
                `[Gateway] Stored ${data.behaviorLogs.length} behavior logs for ${data.peerId}`,
            );
        } catch (error) {
            console.error('[Gateway] Error handling behavior logs:', error);
            client.emit('sfu:behavior-logs-error', {
                message: error.message || 'Failed to store behavior logs',
            });
        }
    }

    @SubscribeMessage('sfu:toggle-behavior-monitor')
    async handleToggleBehaviorMonitor(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            peerId: string;
            isActive: boolean;
        },
    ) {
        try {
            console.log(
                `[Gateway] Toggling behavior monitor for room ${data.roomId}: ${data.isActive}`,
            );

            // Validate room creator permission
            const participant = await this.roomClient.getParticipantByPeerId(
                data.roomId,
                data.peerId,
            );
            if (!participant || !participant.is_creator) {
                client.emit('sfu:behavior-monitor-error', {
                    message: 'Only room creator can toggle behavior monitoring',
                });
                return;
            }

            // Broadcast monitor state to all participants in room
            this.io.to(data.roomId).emit('sfu:behavior-monitor-state', {
                isActive: data.isActive,
                triggeredBy: data.peerId,
            });

            // Store monitor state in interaction service
            await this.interactionClient.setBehaviorMonitorState(
                data.roomId,
                data.isActive,
            );

            console.log(
                `[Gateway] Behavior monitoring ${data.isActive ? 'started' : 'stopped'} for room ${data.roomId}`,
            );
        } catch (error) {
            console.error('[Gateway] Error toggling behavior monitor:', error);
            client.emit('sfu:behavior-monitor-error', {
                message: error.message || 'Failed to toggle behavior monitor',
            });
        }
    }

    @SubscribeMessage('sfu:request-user-log')
    async handleRequestUserLog(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            peerId: string;
            targetPeerId: string;
        },
    ) {
        try {
            console.log(
                `[Gateway] Requesting logs from ${data.targetPeerId} for room ${data.roomId}`,
            );

            // Validate room creator permission
            const participant = await this.roomClient.getParticipantByPeerId(
                data.roomId,
                data.peerId,
            );
            if (!participant || !participant.is_creator) {
                client.emit('sfu:request-user-log-error', {
                    message: 'Only room creator can request user logs',
                });
                return;
            }

            // Send request to specific user
            this.io.to(data.roomId).emit('sfu:request-user-log', {
                peerId: data.targetPeerId,
                requestedBy: data.peerId,
            });

            console.log(`[Gateway] Log request sent to ${data.targetPeerId}`);
        } catch (error) {
            console.error('[Gateway] Error requesting user log:', error);
            client.emit('sfu:request-user-log-error', {
                message: error.message || 'Failed to request user log',
            });
        }
    }

    @SubscribeMessage('sfu:download-room-log')
    async handleDownloadRoomLog(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            peerId: string;
        },
        callback?: (response: any) => void,
    ) {
        try {
            console.log(`[Gateway] Downloading room logs for ${data.roomId}`);

            // Validate room creator permission
            const participant = await this.roomClient.getParticipantByPeerId(
                data.roomId,
                data.peerId,
            );
            if (!participant || !participant.is_creator) {
                const errorResponse = {
                    success: false,
                    error: 'Only room creator can download room logs',
                };
                if (callback) callback(errorResponse);
                else client.emit('sfu:download-room-log-error', errorResponse);
                return;
            }

            // Generate Excel file from interaction service
            const excelResult =
                await this.interactionClient.generateRoomLogExcel(data.roomId);

            const response = {
                success: true,
                file:
                    (excelResult as any)?.file ||
                    Buffer.from('No logs available').toString('base64'),
                filename: `behavior-logs-${data.roomId}-${new Date().toISOString().slice(0, 10)}.xlsx`,
            };

            if (callback) {
                callback(response);
            } else {
                client.emit('sfu:download-room-log-success', response);
            }

            console.log(`[Gateway] Room logs generated for ${data.roomId}`);
        } catch (error) {
            console.error('[Gateway] Error downloading room log:', error);
            const errorResponse = {
                success: false,
                error: error.message || 'Failed to download room log',
            };
            if (callback) callback(errorResponse);
            else client.emit('sfu:download-room-log-error', errorResponse);
        }
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

    @SubscribeMessage('sfu:kick-user')
    async handleKickUser(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomId: string;
            participantId: string;
        },
    ) {
        try {
            const requesterPeerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            if (!requesterPeerId) {
                client.emit('sfu:kick-user-response', {
                    success: false,
                    message: 'User not authenticated',
                });
                return;
            }

            console.log('=== Kick User WebSocket ===');
            console.log('Room ID:', data.roomId);
            console.log('Participant ID to kick:', data.participantId);
            console.log('Requester:', requesterPeerId);

            // Check if requester is the creator (has permission to kick)
            const roomResponse = await this.roomClient.getRoom(data.roomId);
            const roomData = roomResponse?.data;

            // Find requester participant to check if they are creator
            const participants = await this.roomClient.getParticipants(
                data.roomId,
            );
            const requesterParticipant = participants.find(
                (p) => p.peer_id === requesterPeerId,
            );

            if (!requesterParticipant || !requesterParticipant.is_creator) {
                client.emit('sfu:kick-user-response', {
                    success: false,
                    message: 'Only room creator can kick users',
                });
                return;
            }

            // Call room service to leave room
            const leaveRoomResponse = await this.roomClient.leaveRoom({
                roomId: data.roomId,
                participantId: data.participantId,
                socketId: '', // WebSocket kick doesn't have specific socketId
            });

            // Broadcast leave events to all clients in the room
            this.eventService.broadcastToRoom(
                client,
                data.roomId,
                'sfu:peer-left',
                {
                    peerId: data.participantId,
                    reason: 'kicked',
                },
            );

            this.eventService.broadcastToRoom(
                client,
                data.roomId,
                'sfu:user-removed',
                {
                    peerId: data.participantId,
                    reason: 'kicked',
                },
            );

            // If this was the creator and there's a new creator, send the creator-changed event
            if (leaveRoomResponse?.data?.newCreator) {
                this.eventService.broadcastToRoom(
                    client,
                    data.roomId,
                    'sfu:creator-changed',
                    {
                        peerId: leaveRoomResponse.data.newCreator,
                        isCreator: true,
                    },
                );
            }

            console.log('User kicked successfully:', data.participantId);
            client.emit('sfu:kick-user-response', {
                success: true,
                message: 'User kicked successfully',
            });
        } catch (error) {
            console.error('Error kicking user:', error);
            client.emit('sfu:kick-user-response', {
                success: false,
                message: error.message || 'Failed to kick user',
            });
        }
    }

    // ==================== CHATBOT HANDLERS ====================

    @SubscribeMessage('chatbot:ask')
    async handleChatbotAsk(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { id: string; roomId: string; text: string },
    ) {
        try {
            console.log(`[Chatbot] Request from ${client.id}:`, {
                requestId: data.id,
                roomId: data.roomId,
                question: data.text?.substring(0, 100) + '...',
            });

            // Security: Validate user is in the room
            const socketRooms = Array.from(client.rooms);
            if (!socketRooms.includes(data.roomId)) {
                console.warn(
                    `[Chatbot] Access denied - client ${client.id} not in room ${data.roomId}`,
                );
                client.emit('chatbot:error', {
                    requestId: data.id,
                    message: 'Access denied: You are not in this room',
                });
                return;
            }

            // Validate input
            if (!data.text || data.text.trim().length === 0) {
                client.emit('chatbot:error', {
                    requestId: data.id,
                    message: 'Question cannot be empty',
                });
                return;
            }

            if (data.text.length > 2000) {
                client.emit('chatbot:error', {
                    requestId: data.id,
                    message: 'Question too long (max 2000 characters)',
                });
                return;
            }

            // Get peerId from socket data (set during join)
            const peerId = this.helperService.getParticipantBySocketId(
                client.id,
            );
            if (!peerId) {
                client.emit('chatbot:error', {
                    requestId: data.id,
                    message: 'User not authenticated',
                });
                return;
            }

            // Rate limiting check (optional - can implement later)
            // const canProceed = await this.rateLimitCheck(peerId);
            // if (!canProceed) { ... }

            // Call chatbot service
            console.log(
                `[Chatbot] Processing request for user ${peerId} in room ${data.roomId}`,
            );

            const response = await this.chatbotClient.askChatBot({
                question: data.text.trim(),
                room_id: data.roomId,
            });

            // Send final response (for now, no streaming)
            client.emit('chatbot:final', {
                requestId: data.id,
                text:
                    response.answer ||
                    'I apologize, but I could not generate a response.',
            });

            console.log(`[Chatbot] Response sent for request ${data.id}`);
        } catch (error) {
            console.error(
                `[Chatbot] Error processing request ${data.id}:`,
                error,
            );

            let errorMessage =
                'Sorry, I encountered an error while processing your request.';

            // Handle specific error types
            if (error.message?.includes('timeout')) {
                errorMessage = 'Request timed out. Please try again.';
            } else if (error.message?.includes('rate limit')) {
                errorMessage =
                    'Too many requests. Please wait a moment before asking again.';
            } else if (error.message?.includes('service unavailable')) {
                errorMessage =
                    'AI service is temporarily unavailable. Please try again later.';
            }

            client.emit('chatbot:error', {
                requestId: data.id,
                message: errorMessage,
            });
        }
    }

    // Whiteboard Events
    @SubscribeMessage('whiteboard:update')
    async handleWhiteboardUpdate(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: any,
    ) {
        return this.whiteboardHandler.handleUpdateWhiteboard(client, data);
    }

    @SubscribeMessage('whiteboard:get-data')
    async handleGetWhiteboardData(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: any,
    ) {
        return this.whiteboardHandler.handleGetWhiteboardData(client, data);
    }

    @SubscribeMessage('whiteboard:clear')
    async handleClearWhiteboard(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: any,
    ) {
        return this.whiteboardHandler.handleClearWhiteboard(client, data);
    }

    @SubscribeMessage('whiteboard:update-permissions')
    async handleUpdateWhiteboardPermissions(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: any,
    ) {
        return this.whiteboardHandler.handleUpdatePermissions(client, data);
    }

    @SubscribeMessage('whiteboard:get-permissions')
    async handleGetWhiteboardPermissions(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: any,
    ) {
        return this.whiteboardHandler.handleGetPermissions(client, data);
    }

    @SubscribeMessage('whiteboard:pointer')
    async handleWhiteboardPointer(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: any,
    ) {
        return this.whiteboardHandler.handlePointerUpdate(client, data);
    }

    @SubscribeMessage('whiteboard:pointer-leave')
    async handleWhiteboardPointerLeave(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: any,
    ) {
        return this.whiteboardHandler.handlePointerLeave(client, data);
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
