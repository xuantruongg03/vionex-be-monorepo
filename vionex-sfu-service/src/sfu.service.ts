import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mediasoupTypes from 'mediasoup/node/lib/types';
import {
    MAX_PRIORITY_USERS,
    SMALL_ROOM_MAX_USERS,
    SPEAKER_INACTIVITY_THRESHOLD_MS,
} from './constants/sfu.constants';
import * as T from './interface';
import {
    createSafeCabinId,
    createSafeTranslatedStreamId,
} from './utils/sdp-helpers';
import { WorkerPoolService } from './worker-pool/worker-pool.service';
import { logger } from './utils/log-manager';

@Injectable()
export class SfuService implements OnModuleInit, OnModuleDestroy {
    private rooms = new Map<string, Map<string, any>>();
    private webRtcServer!: mediasoupTypes.WebRtcServer; // Using non-null assertion
    private webRtcServerId!: string; // Using non-null assertion

    private worker!: mediasoupTypes.Worker; // Using non-null assertion as it will be initialized in initializeMediasoup
    private mediaRooms = new Map<string, T.MediaRoomInfo>();
    private readonly mediaRouters = new Map<string, mediasoupTypes.Router>();

    private streams = new Map<string, T.Stream>(); // Map<streamId, Stream>
    private producerToStream = new Map<string, T.Stream>(); // Map<producerId, Stream>
    private transports = new Map<string, mediasoupTypes.WebRtcTransport>(); // Map<transportId, Transport>
    private activeSpeakers = new Map<string, Map<string, Date>>(); // Map<roomId, Map<participantId, lastActiveTime>>

    // Pin/Unpin system - Map<roomId, Map<consumerId, Set<publisherId>>>
    // PRIORITY SYSTEM: Pinned users get HIGHEST priority in shouldUserReceiveStream()
    private pinnedUsers = new Map<string, Map<string, Set<string>>>();

    // Enhanced translation cabin support with bidirectional transports
    private translationCabins = new Map<
        string,
        {
            receiveTransport: mediasoupTypes.PlainTransport;
            sendTransport: mediasoupTypes.PlainTransport;
            consumer: mediasoupTypes.Consumer;
            producer?: mediasoupTypes.Producer;
            streamId?: string;
            sourceUserId: string; // User create
            targetUserId: string; // User target translate
            sourceLanguage: string;
            targetLanguage: string;
            consumers: Set<string>; // List of UserIDs consuming this cabin
            createdAt: Date;
        }
    >(); // Map<cabinId, bidirectional transport info>

    constructor(
        private configService: ConfigService,
        private readonly workerPool: WorkerPoolService,
    ) {}
    async onModuleInit() {
        try {
            await this.initializeMediasoup();
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                'SfuService: Failed to initialize',
                error,
            );
            throw error;
        }
    }

    private async initializeMediasoup() {
        try {
            // Use the async method to get a worker, which will initialize workers if needed
            // or wait for initialization to complete
            this.worker = await this.workerPool.getWorkerAsync();
            // Try to get a WebRTC server from the worker pool, prioritizing the worker-specific one
            const webRtcServer =
                this.workerPool.getWebRtcServerForWorker(
                    this.worker.pid.toString(),
                ) ||
                this.workerPool.getSharedWebRtcServer(
                    this.worker.pid.toString(),
                );

            if (!webRtcServer) {
                throw new Error('No WebRTC server available from worker pool');
            }

            this.webRtcServer = webRtcServer;

            this.webRtcServerId = this.webRtcServer.id;
            // Register error handler for the worker
            this.worker.on('died', () => {
                logger.error(
                    'sfu.service.ts',
                    'Main mediasoup worker died, exiting in 2 seconds...',
                );
                setTimeout(() => process.exit(1), 2000);
            });
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                'Failed to create mediasoup worker or WebRTC server',
                error,
            );
            throw error;
        }
    }

    async onModuleDestroy() {
        await this.workerPool.closeAll();
        if (this.worker) {
            await this.worker.close();
        }
    }

    async createMediaRoom(roomId: string): Promise<mediasoupTypes.Router> {
        if (this.mediaRouters.has(roomId)) {
            return this.mediaRouters.get(roomId)!;
        }

        // Lấy worker theo roomId để đảm bảo cùng một room luôn ở trên cùng một worker
        const worker = await this.workerPool.getWorkerByRoomIdAsync(roomId);

        // Lưu thông tin room
        this.mediaRooms.set(roomId, {
            router: null,
            producers: new Map(),
            consumers: new Map(),
            workerId: worker.pid.toString(),
        });

        const router = await worker.createRouter({
            mediaCodecs: [
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 2,
                },
                {
                    kind: 'video',
                    mimeType: 'video/VP8',
                    clockRate: 90000,
                    parameters: {
                        'x-google-start-bitrate': 1000,
                    },
                },
                {
                    kind: 'video',
                    mimeType: 'video/VP9',
                    clockRate: 90000,
                    parameters: {
                        'profile-id': 2,
                        'x-google-start-bitrate': 1000,
                    },
                },
                {
                    kind: 'video',
                    mimeType: 'video/h264',
                    clockRate: 90000,
                    parameters: {
                        'packetization-mode': 1,
                        'profile-level-id': '4d0032',
                        'level-asymmetry-allowed': 1,
                        'x-google-start-bitrate': 1000,
                    },
                },
                {
                    kind: 'video',
                    mimeType: 'video/h264',
                    clockRate: 90000,
                    parameters: {
                        'packetization-mode': 1,
                        'profile-level-id': '42e01f',
                        'level-asymmetry-allowed': 1,
                        'x-google-start-bitrate': 1000,
                    },
                },
            ],
        });

        this.mediaRouters.set(roomId, router);
        const mediaRoom = this.mediaRooms.get(roomId)!;
        mediaRoom.router = router;
        return router;
    }
    async createWebRtcTransport(
        roomId: string,
    ): Promise<mediasoupTypes.WebRtcTransport> {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom || !mediaRoom.router) {
            throw new Error(`Room ${roomId} not found`);
        }

        try {
            const workerId = mediaRoom.workerId || '';
            const webRtcServer =
                this.workerPool.getWebRtcServerForWorker(workerId);

            if (!webRtcServer) {
                // When not using WebRTC server, create transport with dynamic port allocation
                const transportOptions: mediasoupTypes.WebRtcTransportOptions =
                    {
                        listenIps: [
                            {
                                ip:
                                    this.configService.get(
                                        'MEDIASOUP_LISTEN_IP',
                                    ) || '0.0.0.0',
                                announcedIp: this.configService.get(
                                    'MEDIASOUP_ANNOUNCED_IP',
                                ),
                            },
                        ],
                        enableUdp: true,
                        enableTcp: true,
                        preferUdp: true,
                        initialAvailableOutgoingBitrate: 1000000,
                        enableSctp: true,
                        numSctpStreams: { OS: 1024, MIS: 1024 },
                        maxSctpMessageSize: 262144,
                    };

                return await mediaRoom.router.createWebRtcTransport(
                    transportOptions,
                );
            }

            // Use the WebRTC server for this worker
            const transportOptions: mediasoupTypes.WebRtcTransportOptions = {
                webRtcServer,
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
                initialAvailableOutgoingBitrate: 1000000,
                enableSctp: true,
                numSctpStreams: { OS: 1024, MIS: 1024 },
                maxSctpMessageSize: 262144,
            };

            const transport =
                await mediaRoom.router.createWebRtcTransport(transportOptions);

            // Store transport for later access
            this.transports.set(transport.id, transport);
            // Set up cleanup when transport closes
            transport.on('routerclose', () => {
                this.transports.delete(transport.id);
            });

            transport.on('@close', () => {
                this.transports.delete(transport.id);
            });

            return transport;
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `Failed to create WebRTC transport in room ${roomId}`,
                error,
            );
            throw error;
        }
    }

    async createWebRtcTransportWithIceServers(roomId: string): Promise<{
        transport: mediasoupTypes.WebRtcTransport;
        iceServers: any[];
    }> {
        const transport = await this.createWebRtcTransport(roomId);
        const iceServers = await this.getIceServers();

        return {
            transport,
            iceServers,
        };
    }

    async getIceServers() {
        if (this.configService.get('USE_ICE_SERVERS') == 'true') {
            return [
                {
                    urls:
                        this.configService.get('STUN_SERVER_URL') ||
                        'stun:stun.l.google.com:19302',
                },
                {
                    urls:
                        this.configService.get('TURN_SERVER_URL') ||
                        'turn:turnserver.example.com:3478',
                    username:
                        this.configService.get('TURN_SERVER_USERNAME') ||
                        'user',
                    credential:
                        this.configService.get('TURN_SERVER_PASSWORD') ||
                        'pass',
                },
            ];
        }
        return [];
    }

    saveProducer(
        roomId: string,
        streamId: string,
        producer: mediasoupTypes.Producer,
    ): void {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) return;

        mediaRoom.producers.set(streamId, producer);
    }

    getProducer(
        roomId: string,
        streamId: string,
    ): mediasoupTypes.Producer | undefined {
        return this.mediaRooms.get(roomId)?.producers.get(streamId);
    }

    async getMediaRouter(roomId: string): Promise<mediasoupTypes.Router> {
        if (!this.mediaRouters.has(roomId)) {
            return this.createMediaRoom(roomId);
        }
        return this.mediaRouters.get(roomId)!;
    }

    saveConsumer(
        roomId: string,
        streamId: string,
        consumer: mediasoupTypes.Consumer,
    ): void {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) return;

        if (!mediaRoom.consumers.has(streamId)) {
            mediaRoom.consumers.set(streamId, []);
        }

        const consumers = mediaRoom.consumers.get(streamId);
        if (consumers) {
            consumers.push(consumer);
        }
    }

    async removeProducer(roomId: string, streamId: string): Promise<void> {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) return;

        mediaRoom.producers.delete(streamId);

        if (mediaRoom.consumers.has(streamId)) {
            for (const consumer of mediaRoom.consumers.get(streamId) || []) {
                consumer.close();
            }
            mediaRoom.consumers.delete(streamId);
        }
    }

    async closeMediaRoom(roomId: string): Promise<void> {
        const router = this.mediaRouters.get(roomId);
        if (router) {
            await router.close();
            this.mediaRouters.delete(roomId);
            this.mediaRooms.delete(roomId);

            // Clean the Speaking Data when closing the room
            this.clearRoomSpeaking(roomId);

            // Clean the translation cabins
            this.clearTranslationCabins(roomId);

            // Clean the pinned users for this room
            this.clearPinsForRoom(roomId);
        }
    }

    canConsume(
        roomId: string,
        producerId: string,
        rtpCapabilities: mediasoupTypes.RtpCapabilities,
    ): boolean {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom || !mediaRoom.router) return false;

        try {
            return mediaRoom.router.canConsume({
                producerId,
                rtpCapabilities,
            });
        } catch (error) {
            logger.error('sfu.service.ts', 'canConsume() error', error);
            return false;
        }
    }

    // Stream creation with roomId
    createStream(
        streamId: string,
        publisherId: string,
        producerId: string,
        rtpParameters: mediasoupTypes.RtpParameters,
        metadata: any,
        roomId: string,
    ): T.Stream {
        const stream: T.Stream = {
            streamId,
            publisherId,
            producerId,
            metadata,
            rtpParameters,
            roomId,
        };

        this.streams.set(streamId, stream);
        this.producerToStream.set(producerId, stream);
        return stream;
    }

    // Stream management with room awareness
    getStreamsByRoom(roomId: string): T.Stream[] {
        return Array.from(this.streams.values()).filter(
            (stream) => stream.roomId === roomId,
        );
    }

    getStreamCount(roomId: string): number {
        return this.getStreamsByRoom(roomId).length;
    }

    // ENHANCED: Priority stream management based on speaking activity and special status
    // This replaces the old static "first 10 streams" logic with intelligent prioritization
    getPriorityStreams(roomId: string): T.Stream[] {
        const allRoomStreams = this.getStreamsByRoom(roomId);

        // Use the enhanced priority sorting that considers speaking activity
        const sortedStreams = this.sortStreamsByPriority(
            allRoomStreams,
            roomId,
        );

        // Get prioritized users (speaking + special + top streams)
        const prioritizedUsers = this.getPrioritizedUsers(roomId);

        // Return streams from prioritized users
        const priorityStreams = sortedStreams.filter((stream) =>
            prioritizedUsers.has(stream.publisherId),
        );

        return priorityStreams;
    }

    isStreamInPriority(roomId: string, streamId: string): boolean {
        const priorityStreams = this.getPriorityStreams(roomId);
        return priorityStreams.some((stream) => stream.streamId === streamId);
    }

    deleteStream(streamId: string): boolean {
        if (this.streams.has(streamId)) {
            this.streams.delete(streamId);
            return true;
        } else {
            logger.warn(
                'sfu.service.ts',
                `Stream with ID ${streamId} does not exist`,
            );
            return false;
        }
    }

    saveStream(stream: T.Stream): boolean {
        if (this.streams.has(stream.streamId)) {
            return false;
        }
        this.streams.set(stream.streamId, stream);
        return true;
    }

    removeStream(roomId: string, streamId: string): boolean {
        if (this.streams.has(streamId)) {
            this.streams.delete(streamId);
            return true;
        }
        logger.warn(
            'sfu.service.ts',
            `Stream with ID ${streamId} does not exist`,
        );
        return false;
    }

    saveProducerToStream(producerId: string, stream: T.Stream): boolean {
        const hasStream = this.streams.get(stream.streamId);
        if (!hasStream) {
            logger.warn(
                'sfu.service.ts',
                `Stream with ID ${stream.streamId} does not exist`,
            );
            return false;
        }
        this.producerToStream.set(producerId, stream);
        return true;
    }

    // PIN/UNPIN Helper Methods
    private isPinnedUser(
        roomId: string,
        consumerId: string,
        publisherId: string,
    ): boolean {
        const roomPins = this.pinnedUsers.get(roomId);
        if (!roomPins) return false;

        const userPins = roomPins.get(consumerId);
        return userPins ? userPins.has(publisherId) : false;
    }

    private initializePinForRoom(roomId: string): void {
        if (!this.pinnedUsers.has(roomId)) {
            this.pinnedUsers.set(roomId, new Map());
        }
    }

    private initializePinForUser(roomId: string, userId: string): void {
        this.initializePinForRoom(roomId);
        const roomPins = this.pinnedUsers.get(roomId)!;
        if (!roomPins.has(userId)) {
            roomPins.set(userId, new Set());
        }
    }
    private shouldUserReceiveStream(
        roomId: string,
        consumerId: string,
        publisherId: string,
    ): boolean {
        // Use mediaRooms instead of rooms for room state
        const mediaRoom = this.mediaRooms.get(roomId);

        if (!mediaRoom) {
            logger.debug(
                'sfu.service.ts',
                `[SFU DEBUG] Media room ${roomId} not found`,
            );
            return false;
        }

        // Calculate total users from room streams (unique publishers)
        const roomStreams = this.getStreamsByRoom(roomId);
        const uniqueUsers = new Set(roomStreams.map((s) => s.publisherId));
        const totalUsers = uniqueUsers.size;

        // PRIORITY 0: Pinned users always consume (highest priority)
        if (this.isPinnedUser(roomId, consumerId, publisherId)) {
            return true;
        }

        // For small rooms (≤SMALL_ROOM_MAX_USERS), consume all streams
        if (totalUsers <= SMALL_ROOM_MAX_USERS) {
            return true;
        }

        // PRIORITY 1: Speaking users always consume (bypass limit)
        if (this.isUserSpeaking(roomId, publisherId)) {
            return true;
        }

        // PRIORITY 2: Special users (screen share, translation, etc.)
        if (this.isSpecialUser(roomId, publisherId)) {
            return true;
        }

        // PRIORITY 3: For large rooms (>SMALL_ROOM_MAX_USERS), check priority list
        const prioritizedUsers = this.getPrioritizedUsers(roomId);
        const isInPriorityList = prioritizedUsers.has(publisherId);

        if (isInPriorityList) {
            return true;
        }
        return false;
    }

    /**
     * Get prioritized users for large rooms (>SMALL_ROOM_MAX_USERS)
     *
     * Priority allocation (only for rooms with >10 users):
     * 1. Speaking users (unlimited, within SPEAKING_THRESHOLD_MS)
     * 2. Special users (unlimited, screen share/translation)
     * 3. Regular users (limited to MAX_PRIORITY_USERS, FIFO by stream creation time)
     *
     * Note: Pinned users are handled separately in shouldUserReceiveStream()
     */
    private getPrioritizedUsers(roomId: string): Set<string> {
        const prioritizedUsers = new Set<string>();

        // Step 1: Add currently speaking users (unlimited slots)
        const roomSpeakers = this.activeSpeakers.get(roomId);
        if (roomSpeakers) {
            // Add ALL speakers trong list, KHÔNG check timeout
            roomSpeakers.forEach((lastSpeakTime, peerId) => {
                prioritizedUsers.add(peerId);
            });
        }

        // Step 2: Add special users (unlimited slots - screen share, translation, etc.)
        const allRoomStreams = this.getStreamsByRoom(roomId);
        const specialUsers = new Set<string>();
        allRoomStreams.forEach((stream) => {
            if (this.isSpecialUser(roomId, stream.publisherId)) {
                specialUsers.add(stream.publisherId);
            }
        });
        specialUsers.forEach((userId) => {
            prioritizedUsers.add(userId);
        });

        // Step 3: Fill remaining slots with regular users (limited to MAX_PRIORITY_USERS)
        // This ensures first-joined users get priority when room is crowded
        const remainingSlots = Math.max(
            0,
            MAX_PRIORITY_USERS - prioritizedUsers.size,
        );
        if (remainingSlots > 0) {
            // Get streams sorted by priority (FIFO - older streams first)
            // Exclude already prioritized users (speaking/special)
            const sortedStreams = this.sortStreamsByPriority(
                allRoomStreams,
                roomId,
            ).filter((stream) => !prioritizedUsers.has(stream.publisherId));

            // Add users from highest priority streams until we reach MAX_PRIORITY_USERS
            const addedUsers = new Set<string>();
            for (const stream of sortedStreams) {
                if (addedUsers.size >= remainingSlots) break;

                if (!addedUsers.has(stream.publisherId)) {
                    prioritizedUsers.add(stream.publisherId);
                    addedUsers.add(stream.publisherId);
                }
            }
        }
        return prioritizedUsers;
    }

    // //TODO: Additional method to get recent speakers (from old code)
    // private getRecentSpeakers(roomId: string, limit: number): string[] {
    //     // Logic này có thể được mở rộng để track speaking activity
    //     // Hiện tại chỉ return empty array
    //     return [];
    // }

    // // Method to notify user about stream changes (from old code)
    // private notifyUserStreamChanges(roomId: string, userId: string): void {
    //     // Logic này có thể được mở rộng để notify qua WebSocket
    // }

    getStreamByProducerId(producerId: string): T.Stream | undefined {
        return this.producerToStream.get(producerId);
    }

    // Worker management methods
    getWorkerInfoForRoom(roomId: string): { workerId: string } | null {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) return null;

        return { workerId: mediaRoom.workerId || 'unknown' };
    }

    async getWorkersStatus(): Promise<any[]> {
        const workers = this.workerPool.getAllWorkers();
        const status: any[] = [];

        for (const worker of workers) {
            const usage = await worker.getResourceUsage();
            const workerRooms = Array.from(this.mediaRooms.entries())
                .filter(
                    ([_, mediaRoom]) =>
                        mediaRoom.workerId === worker.pid.toString(),
                )
                .map(([roomId, _]) => roomId);

            status.push({
                workerId: worker.pid,
                usage,
                rooms: workerRooms,
            });
        }

        return status;
    }

    async createConsumer(
        roomId: string,
        streamId: string,
        transportId: string,
        rtpCapabilities: any,
        participant: any,
        forcePinConsumer: boolean = false,
    ) {
        try {
            // Get the media room
            const mediaRoom = this.mediaRooms.get(roomId);
            if (!mediaRoom || !mediaRoom.router) {
                throw new Error(`Media room ${roomId} not found`);
            }

            // Get the transport
            const transport = this.transports.get(transportId);
            if (!transport) {
                throw new Error(`Transport ${transportId} not found`);
            }

            // Get the stream to find the producer
            const stream = this.streams.get(streamId);
            if (!stream) {
                // Try to find a similar stream from the same participant (fallback mechanism)
                const streamParts = streamId.split('_');
                if (streamParts.length >= 2) {
                    const participantId = streamParts[0];
                    const mediaType = streamParts[1];

                    // Look for any stream from the same participant with the same media type
                    const alternativeStream = Array.from(
                        this.streams.values(),
                    ).find(
                        (s) =>
                            s.publisherId === participantId &&
                            s.streamId.includes(`_${mediaType}_`),
                    );

                    if (alternativeStream) {
                        // Use the alternative stream
                        return await this.createConsumer(
                            roomId,
                            alternativeStream.streamId,
                            transportId,
                            rtpCapabilities,
                            participant,
                            forcePinConsumer,
                        );
                    }
                }

                throw new Error(`Stream ${streamId} not found`);
            }

            // ENHANCED: Check if user should receive this stream with speaking priority
            if (
                !forcePinConsumer &&
                !this.shouldUserReceiveStream(
                    roomId,
                    participant.peerId || participant.peer_id,
                    stream.publisherId,
                )
            ) {
                return {
                    consumerId: null,
                    consumer: null,
                    kind: stream.metadata?.kind || 'unknown',
                    rtpParameters: null,
                    streamId: streamId,
                    producerId: stream.producerId,
                    message:
                        'Stream not in priority list - prioritizing speaking users and special users',
                };
            }

            // Get the producer by its producerId (not streamId)
            let producer: mediasoupTypes.Producer | undefined;
            for (const [, p] of mediaRoom.producers.entries()) {
                if (p.id === stream.producerId) {
                    producer = p;
                    break;
                }
            }

            if (!producer) {
                throw new Error(
                    `Producer ${stream.producerId} for stream ${streamId} not found in media room`,
                );
            }

            // If no RTP capabilities provided, use router capabilities as fallback
            let finalRtpCapabilities = rtpCapabilities;
            if (!rtpCapabilities || Object.keys(rtpCapabilities).length === 0) {
                finalRtpCapabilities = mediaRoom.router.rtpCapabilities;
            }

            // Check if router can consume this producer with the given capabilities
            if (
                !mediaRoom.router.canConsume({
                    producerId: producer.id,
                    rtpCapabilities: finalRtpCapabilities,
                })
            ) {
                throw new Error(
                    `Router cannot consume producer ${producer.id}`,
                );
            }

            // Create consumer
            const consumer = await transport.consume({
                producerId: producer.id,
                rtpCapabilities: finalRtpCapabilities,
                paused: true,
            });
            // Store consumer in media room - use streamId as key and store array of consumers
            if (!mediaRoom.consumers.has(streamId)) {
                mediaRoom.consumers.set(streamId, []);
            }
            const consumers = mediaRoom.consumers.get(streamId);
            if (consumers) {
                consumers.push(consumer);
            }

            return {
                consumerId: consumer.id,
                consumer,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                streamId: streamId,
                producerId: producer.id,
                metadata: stream.metadata, // Include stream metadata for client processing
            };
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                '[SFU] Failed to create consumer',
                error,
            );
            throw error;
        }
    }

    async resumeConsumer(
        roomId: string,
        consumerId: string,
        participantId: string,
    ): Promise<void> {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) {
            throw new Error(`Media room ${roomId} not found`);
        }

        // Find consumer across all streams
        for (const consumers of mediaRoom.consumers.values()) {
            const consumer = consumers.find((c) => c.id === consumerId);
            if (consumer) {
                await consumer.resume();
                return;
            }
        }

        throw new Error(`Consumer ${consumerId} not found in room ${roomId}`);
    }

    // Transport management
    getTransport(
        transportId: string,
    ): mediasoupTypes.WebRtcTransport | undefined {
        return this.transports.get(transportId);
    }

    storeTransport(
        transportId: string,
        transport: mediasoupTypes.WebRtcTransport,
    ): void {
        this.transports.set(transportId, transport);
    }

    removeTransport(transportId: string): void {
        this.transports.delete(transportId);
    }

    // Transport connection
    async connectTransport(
        transportId: string,
        dtlsParameters: mediasoupTypes.DtlsParameters,
    ): Promise<void> {
        const transport = this.transports.get(transportId);
        if (!transport) {
            throw new Error(`Transport ${transportId} not found`);
        }

        await transport.connect({ dtlsParameters });
    }

    // Stream retrieval method required by controller
    getStream(streamId: string): T.Stream | null {
        const stream = this.streams.get(streamId) || null;
        if (!stream) {
            logger.error(
                'sfu.service.ts',
                `[SFU] Stream ${streamId} not found in streams registry`,
            );
        }
        return stream;
    }

    // Producer creation method
    async createProducer(data: {
        roomId: string;
        transportId: string;
        kind: mediasoupTypes.MediaKind;
        rtpParameters: mediasoupTypes.RtpParameters;
        metadata: any;
        participant: any;
    }) {
        try {
            // Get the media room
            const mediaRoom = this.mediaRooms.get(data.roomId);
            if (!mediaRoom || !mediaRoom.router) {
                throw new Error(`Media room ${data.roomId} not found`);
            }

            // Get the transport
            const transport = this.transports.get(data.transportId);
            if (!transport) {
                throw new Error(`Transport ${data.transportId} not found`);
            }

            // Create producer
            const producer = await transport.produce({
                kind: data.kind,
                rtpParameters: data.rtpParameters,
            });

            let isScreenShare = false;
            // Check metadata
            if (
                data.metadata &&
                (data.metadata.isScreenShare === true ||
                    data.metadata.type === 'screen' ||
                    data.metadata.type === 'screen_audio')
            ) {
                isScreenShare = true;
            }
            // Check producer.appData (for WebSocket/mediasoup-client)
            if (
                producer.appData &&
                (producer.appData.isScreenShare === true ||
                    producer.appData.type === 'screen' ||
                    producer.appData.type === 'screen_audio')
            ) {
                isScreenShare = true;
            }

            let streamType: string = data.kind; // Default to original kind (video/audio)
            if (isScreenShare) {
                streamType = data.kind === 'audio' ? 'screen_audio' : 'screen';
            }

            // Generate a more unique streamId to avoid collisions
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36).substr(2, 5);
            // Keep original peerId for client logic compatibility, DO NOT sanitize streamId
            const originalPeerId =
                data.participant.peerId || data.participant.peer_id;
            let streamId = `${originalPeerId}_${streamType}_${timestamp}_${randomSuffix}`;

            // Ensure streamId is unique
            let counter = 0;
            while (this.streams.has(streamId) && counter < 10) {
                counter++;
                const newRandomSuffix = Math.random().toString(36).substr(2, 5);
                streamId = `${originalPeerId}_${streamType}_${timestamp}_${newRandomSuffix}_${counter}`;
            }

            // Store producer in media room
            mediaRoom.producers.set(streamId, producer);

            // Create and store the stream object with enhanced metadata
            // FIXED: Validate metadata against actual producer state
            // If metadata indicates media is off (audio/video: false) or isDummy: true,
            // the producer should be paused immediately
            const isDummyTrack = data.metadata?.isDummy === true;
            const isMediaOff =
                data.kind === 'video'
                    ? data.metadata?.video === false
                    : data.metadata?.audio === false;

            // Auto-pause producer if it's a dummy track or media is off
            if (isDummyTrack || isMediaOff) {
                await producer.pause();
                logger.info(
                    'sfu.service.ts',
                    `[SFU] Auto-paused ${data.kind} producer for ${originalPeerId} - isDummy: ${isDummyTrack}, isMediaOff: ${isMediaOff}`,
                );
            }

            // Enhanced metadata with actual state validation
            const enhancedMetadata = {
                ...data.metadata,
                isScreenShare: isScreenShare,
                type: isScreenShare
                    ? streamType
                    : data.metadata?.type || 'webcam',
                streamType: streamType,
                // FIX: Ensure metadata reflects actual media state
                // If producer is paused, media should be false
                video:
                    data.kind === 'video'
                        ? producer.paused
                            ? false
                            : (data.metadata?.video ?? true)
                        : (data.metadata?.video ?? false),
                audio:
                    data.kind === 'audio'
                        ? producer.paused
                            ? false
                            : (data.metadata?.audio ?? true)
                        : (data.metadata?.audio ?? false),
                paused: producer.paused, // Track producer paused state
            };

            const stream = this.createStream(
                streamId,
                data.participant.peerId || data.participant.peer_id,
                producer.id,
                data.rtpParameters,
                enhancedMetadata,
                data.roomId,
            );

            // Log priority information (từ mã cũ)
            const totalStreams = this.getStreamsByRoom(data.roomId).length;
            const isInPriority = this.isStreamInPriority(data.roomId, streamId);

            return {
                producer,
                producerId: producer.id,
                streamId: streamId,
                isPriority: isInPriority,
                totalStreams: totalStreams,
            };
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                '[SFU] Failed to create producer',
                error,
            );
            throw error;
        }
    }

    // Stream update method
    async updateStream(
        streamId: string,
        participantId: string,
        metadata: any,
        roomId: string,
    ): Promise<void> {
        const stream = this.streams.get(streamId);
        if (!stream) {
            throw new Error(`Stream ${streamId} not found`);
        }

        // Get the media room and producer to sync state
        const mediaRoom = this.mediaRooms.get(roomId);
        const producer = mediaRoom?.producers.get(streamId);

        // FIXED: Validate and sync metadata with producer state
        if (producer) {
            // If metadata indicates media is toggled off, pause the producer
            const isVideoStream = producer.kind === 'video';
            const isAudioStream = producer.kind === 'audio';

            if (isVideoStream && metadata.video === false && !producer.paused) {
                await producer.pause();
                logger.info(
                    'sfu.service.ts',
                    `[SFU] Paused video producer ${streamId} due to metadata update`,
                );
            } else if (
                isVideoStream &&
                metadata.video === true &&
                producer.paused
            ) {
                await producer.resume();
                logger.info(
                    'sfu.service.ts',
                    `[SFU] Resumed video producer ${streamId} due to metadata update`,
                );
            }

            if (isAudioStream && metadata.audio === false && !producer.paused) {
                await producer.pause();
                logger.info(
                    'sfu.service.ts',
                    `[SFU] Paused audio producer ${streamId} due to metadata update`,
                );
            } else if (
                isAudioStream &&
                metadata.audio === true &&
                producer.paused
            ) {
                await producer.resume();
                logger.info(
                    'sfu.service.ts',
                    `[SFU] Resumed audio producer ${streamId} due to metadata update`,
                );
            }

            // Update metadata with actual producer state
            metadata.paused = producer.paused;
        }

        // Update stream metadata
        stream.metadata = { ...stream.metadata, ...metadata };
        this.streams.set(streamId, stream);
    }

    // Stream unpublish method
    async unpublishStream(
        roomId: string,
        streamId: string,
        participantId: string,
    ): Promise<void> {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) {
            throw new Error(`Media room ${roomId} not found`);
        }

        // Get and close producer
        const producer = mediaRoom.producers.get(streamId);
        if (producer) {
            producer.close();
            mediaRoom.producers.delete(streamId);
        }

        // Close consumers
        const consumers = mediaRoom.consumers.get(streamId);
        if (consumers) {
            consumers.forEach((consumer) => consumer.close());
            mediaRoom.consumers.delete(streamId);
        }

        // Remove stream and producer mapping
        this.streams.delete(streamId);
        if (producer) {
            this.producerToStream.delete(producer.id);
        }
    }

    // Remove participant media method
    removeParticipantMedia(roomId: string, participantId: string): string[] {
        const removedStreams: string[] = [];
        const roomStreams = this.getStreamsByRoom(roomId);

        for (const stream of roomStreams) {
            if (stream.publisherId === participantId) {
                // Remove from media room
                const mediaRoom = this.mediaRooms.get(roomId);
                if (mediaRoom) {
                    const producer = mediaRoom.producers.get(stream.streamId);
                    if (producer) {
                        producer.close();
                        mediaRoom.producers.delete(stream.streamId);
                    }

                    const consumers = mediaRoom.consumers.get(stream.streamId);
                    if (consumers) {
                        consumers.forEach((consumer) => consumer.close());
                        mediaRoom.consumers.delete(stream.streamId);
                    }
                }

                // Remove from streams registry
                this.streams.delete(stream.streamId);
                this.producerToStream.delete(stream.producerId);
                removedStreams.push(stream.streamId);
            }
        }

        // Dọn dẹp speaking data khi participant rời phòng
        this.removeParticipantSpeaking(roomId, participantId);

        return removedStreams;
    }

    // ================== ENHANCED PIN/UNPIN LOGIC ==================

    /**
     * Pin a user for consumption - with smart consumer reuse and pin system integration
     */
    async pinUser(
        roomId: string,
        pinnerPeerId: string,
        pinnedPeerId: string,
        transportId: string,
        rtpCapabilities: any,
    ): Promise<{
        success: boolean;
        message: string;
        consumersCreated?: any[];
        alreadyPriority?: boolean;
        existingConsumer?: boolean;
    }> {
        try {
            // Add to pin system first
            this.initializePinForUser(roomId, pinnerPeerId);
            const userPins = this.pinnedUsers.get(roomId)!.get(pinnerPeerId)!;

            const wasAlreadyPinned = userPins.has(pinnedPeerId);
            userPins.add(pinnedPeerId);

            // Get all streams from the pinned user
            const pinnedUserStreams = this.getStreamsByRoom(roomId).filter(
                (stream) => stream.publisherId === pinnedPeerId,
            );

            if (pinnedUserStreams.length === 0) {
                return {
                    success: false,
                    message: `No streams found for user ${pinnedPeerId}`,
                };
            }

            // Check if pinned user is already in priority (top 10)
            const priorityStreams = this.getPriorityStreams(roomId);
            const isAlreadyPriority = pinnedUserStreams.some((stream) =>
                priorityStreams.some((p) => p.streamId === stream.streamId),
            );

            // Case 1: Already pinned AND in priority - no action needed
            if (isAlreadyPriority && wasAlreadyPinned) {
                return {
                    success: true,
                    message: `User ${pinnedPeerId} is already pinned and in priority`,
                    alreadyPriority: true,
                    existingConsumer: true,
                    consumersCreated: [],
                };
            }

            // Case 2: Not pinned but already in priority - just update pin state, no new consumers
            if (isAlreadyPriority && !wasAlreadyPinned) {
                return {
                    success: true,
                    message: `User ${pinnedPeerId} pinned (already in priority view)`,
                    alreadyPriority: true,
                    existingConsumer: true,
                    consumersCreated: [], // No new consumers created
                };
            }

            // Create consumers for all streams from pinned user (with reuse check)
            const consumersCreated: any[] = [];
            const participant = { peerId: pinnerPeerId, peer_id: pinnerPeerId };

            for (const stream of pinnedUserStreams) {
                try {
                    // For pin functionality, always attempt to create consumer
                    // MediaSoup will handle duplicates appropriately
                    const consumerResult = await this.createConsumer(
                        roomId,
                        stream.streamId,
                        transportId,
                        rtpCapabilities,
                        participant,
                        true, // forcePinConsumer = true for pinned streams
                    );

                    if (consumerResult.consumer) {
                        consumersCreated.push({
                            streamId: stream.streamId,
                            consumerId: consumerResult.consumer.id,
                            kind: consumerResult.kind,
                            rtpParameters: consumerResult.rtpParameters,
                            producerId: consumerResult.producerId,
                            reused: false, // Always consider as new for pin functionality
                        });
                    }
                } catch (error) {
                    logger.error(
                        'sfu.service.ts',
                        `[SFU] Failed to create consumer for pinned stream ${stream.streamId}`,
                        error,
                    );
                }
            }

            return {
                success: true,
                message: `Successfully pinned user ${pinnedPeerId}`,
                consumersCreated,
                alreadyPriority: isAlreadyPriority,
                existingConsumer: wasAlreadyPinned,
            };
        } catch (error) {
            logger.error('sfu.service.ts', '[SFU] Error in pinUser', error);
            return {
                success: false,
                message: `Failed to pin user: ${error.message}`,
            };
        }
    }

    /**
     * Unpin a user - remove from pin system but keep consuming if bandwidth allows
     */
    async unpinUser(
        roomId: string,
        unpinnerPeerId: string,
        unpinnedPeerId: string,
    ): Promise<{
        success: boolean;
        message: string;
        consumersRemoved?: string[];
        stillInPriority?: boolean;
    }> {
        try {
            // Remove from pin system
            const roomPins = this.pinnedUsers.get(roomId);
            if (!roomPins) {
                return {
                    success: true,
                    message: `No pins found for room ${roomId}`,
                };
            }

            const userPins = roomPins.get(unpinnerPeerId);
            if (!userPins) {
                return {
                    success: true,
                    message: `No pins found for user ${unpinnerPeerId}`,
                };
            }

            const wasRemoved = userPins.delete(unpinnedPeerId);

            // Get all streams from the unpinned user
            const unpinnedUserStreams = this.getStreamsByRoom(roomId).filter(
                (stream) => stream.publisherId === unpinnedPeerId,
            );

            if (unpinnedUserStreams.length === 0) {
                return {
                    success: wasRemoved,
                    message: wasRemoved
                        ? `Unpinned ${unpinnedPeerId}, but no streams found`
                        : `User ${unpinnedPeerId} was not pinned`,
                };
            }

            // Check if unpinned user is still in priority (top 10) - they can continue consuming
            const priorityStreams = this.getPriorityStreams(roomId);
            const isStillInPriority = unpinnedUserStreams.some((stream) =>
                priorityStreams.some((p) => p.streamId === stream.streamId),
            );

            if (wasRemoved) {
                return {
                    success: true,
                    message: `Unpinned ${unpinnedPeerId} from ${unpinnerPeerId}, streams continue if priority allows`,
                    consumersRemoved: [], // No consumers removed on unpin
                    stillInPriority: isStillInPriority,
                };
            } else {
                return {
                    success: true,
                    message: `User ${unpinnedPeerId} was not pinned for ${unpinnerPeerId}`,
                    stillInPriority: isStillInPriority,
                };
            }
        } catch (error) {
            logger.error('sfu.service.ts', '[SFU] Error in unpinUser', error);
            return {
                success: false,
                message: `Failed to unpin user: ${error.message}`,
            };
        }
    }

    async handleSpeaking(
        request: T.HandleSpeakingRequest,
    ): Promise<T.HandleSpeakingResponse> {
        const roomId = request.room_id;
        const peerId = request.peer_id;
        try {
            // ORIGINAL LOGIC: Track active speakers - KEPT
            if (!this.activeSpeakers.has(roomId)) {
                this.activeSpeakers.set(roomId, new Map());
            }

            const roomSpeakers = this.activeSpeakers.get(roomId);
            if (roomSpeakers) {
                roomSpeakers.set(peerId, new Date());
            }
            await this.handleSpeakingUserStreamPriority(roomId, peerId);

            return {
                status: 'success',
                message: 'Speaker updated with priority',
            };
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `[SFU] Error handling speaking for ${peerId} in room ${roomId}`,
                error,
            );
            return {
                status: 'error',
                message: `Failed to update speaker: ${error.message}`,
            };
        }
    }

    // ENHANCED: Handle stop speaking request with priority management
    async handleStopSpeaking(
        request: T.HandleStopSpeakingRequest,
    ): Promise<T.HandleStopSpeakingResponse> {
        const roomId = request.room_id;
        const peerId = request.peer_id;
        try {
            // ORIGINAL LOGIC: Remove from active speakers - KEPT
            if (this.activeSpeakers.has(roomId)) {
                const roomSpeakers = this.activeSpeakers.get(roomId);
                if (roomSpeakers && roomSpeakers.has(peerId)) {
                    // Remove the peer from the speaking list
                    roomSpeakers.delete(peerId);
                }
            }

            // ENHANCED: Clear speaking priority metadata from user's streams
            await this.clearSpeakingPriorityForUser(roomId, peerId);

            // ENHANCED: Rebalance stream priorities now that user stopped speaking
            await this.rebalanceStreamPrioritiesAfterSpeaking(roomId, peerId);

            return {
                status: 'success',
                message: 'Speaker stopped and priorities rebalanced',
            };
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `[SFU] Error handling stop speaking for ${peerId} in room ${roomId}`,
                error,
            );
            return {
                status: 'error',
                message: `Failed to stop speaker: ${error.message}`,
            };
        }
    }

    // Get active speakers in a room
    async getActiveSpeakers(
        request: T.GetActiveSpeakersRequest,
    ): Promise<T.GetActiveSpeakersResponse> {
        const roomId = request.room_id;
        const activeSpeakers: T.ActiveSpeaker[] = [];

        try {
            if (this.activeSpeakers.has(roomId)) {
                const roomSpeakers = this.activeSpeakers.get(roomId);
                roomSpeakers?.forEach((lastSpeakTime, peerId) => {
                    activeSpeakers.push({
                        peer_id: peerId,
                        last_speak_time: lastSpeakTime.getTime().toString(),
                    });
                });
            }

            return { active_speakers: activeSpeakers };
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `[SFU] Error getting active speakers for room ${roomId}`,
                error,
            );
            return { active_speakers: [] };
        }
    }

    getSpeakingStats(roomId: string): {
        totalSpeakers: number;
        activeSpeakers: number;
        recentSpeakers: number;
    } {
        const roomSpeakers = this.activeSpeakers.get(roomId);
        if (!roomSpeakers) {
            return { totalSpeakers: 0, activeSpeakers: 0, recentSpeakers: 0 };
        }

        const currentTime = new Date();
        const activeThreshold = 2000; // 2 giây
        const recentThreshold = 10000; // 10 giây

        let activeSpeakers = 0;
        let recentSpeakers = 0;

        roomSpeakers.forEach((lastSpeakTime) => {
            const timeDiff = currentTime.getTime() - lastSpeakTime.getTime();

            if (timeDiff < activeThreshold) {
                activeSpeakers++;
            }

            if (timeDiff < recentThreshold) {
                recentSpeakers++;
            }
        });

        return {
            totalSpeakers: roomSpeakers.size,
            activeSpeakers,
            recentSpeakers,
        };
    }

    clearRoomSpeaking(roomId: string): void {
        if (this.activeSpeakers.has(roomId)) {
            this.activeSpeakers.delete(roomId);
        }
    }

    removeParticipantSpeaking(roomId: string, peerId: string): void {
        const roomSpeakers = this.activeSpeakers.get(roomId);
        if (roomSpeakers && roomSpeakers.has(peerId)) {
            roomSpeakers.delete(peerId);

            // Clean up room if no speakers remain
            if (roomSpeakers.size === 0) {
                this.activeSpeakers.delete(roomId);
            }
        }
    }

    isUserSpeaking(roomId: string, peerId: string): boolean {
        const roomSpeakers = this.activeSpeakers.get(roomId);
        return roomSpeakers?.has(peerId) || false;
    }

    private async handleSpeakingUserStreamPriority(
        roomId: string,
        speakingPeerId: string,
    ): Promise<void> {
        try {
            // Step 1: Get the media room
            const mediaRoom = this.mediaRooms.get(roomId);
            if (!mediaRoom) {
                logger.warn(
                    'sfu.service.ts',
                    `[SFU] Media room ${roomId} not found for priority handling`,
                );
                return;
            }

            // Step 2: Get speaking user's streams that should be prioritized
            const speakingUserStreams = this.getSpeakingUserStreamsForPriority(
                roomId,
                speakingPeerId,
            );
            if (speakingUserStreams.length === 0) {
                logger.info(
                    'sfu.service.ts',
                    `[SFU] No streams found for speaking user ${speakingPeerId}`,
                );
                return;
            }

            // Step 3: Update priority system - mark speaking user streams as high priority
            await this.updateStreamPriorityForSpeaker(
                roomId,
                speakingUserStreams,
            );

            // Step 4: Check if we need to replace low-priority streams due to threshold
            await this.manageStreamThresholdForSpeaker(
                roomId,
                speakingPeerId,
                speakingUserStreams,
            );
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                '[SFU] Error handling speaking user stream priority',
                error,
            );
        }
    }

    /**
     * ENHANCED: Get speaking user streams that should be prioritized
     * Only regular audio/video streams, not screen shares
     */
    private getSpeakingUserStreamsForPriority(
        roomId: string,
        speakingPeerId: string,
    ): T.Stream[] {
        const roomStreams = this.getStreamsByRoom(roomId);

        return roomStreams.filter((stream) => {
            // Must be from speaking user
            if (stream.publisherId !== speakingPeerId) return false;

            // Parse stream ID to determine type
            const parts = stream.streamId.split('_');
            const mediaType = parts[1]; // video, audio, screen, screen_audio

            // Only prioritize regular audio/video streams, not screen shares
            return mediaType === 'video' || mediaType === 'audio';
        });
    }

    /**
     * ENHANCED: Update stream priority for speaking user
     * This modifies the existing priority system to favor speaking users
     */
    private async updateStreamPriorityForSpeaker(
        roomId: string,
        speakingStreams: T.Stream[],
    ): Promise<void> {
        // Mark speaking streams with high priority metadata
        speakingStreams.forEach((stream) => {
            // Add speaking priority metadata - this extends existing stream metadata
            stream.metadata = {
                ...stream.metadata,
                speakingPriority: true,
                priorityTimestamp: Date.now(),
                isFromSpeaking: true,
            };

            // Update the stored stream
            this.streams.set(stream.streamId, stream);
        });
    }

    /**
     * ENHANCED: Manage stream threshold when speaker is active
     * This replaces the old static priority system with dynamic speaker-based priority
     */
    private async manageStreamThresholdForSpeaker(
        roomId: string,
        speakingPeerId: string,
        speakingStreams: T.Stream[],
    ): Promise<void> {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) return;

        // Count current active consumers across all streams
        let totalActiveConsumers = 0;
        mediaRoom.consumers.forEach((consumers) => {
            totalActiveConsumers += consumers.filter((c) => !c.closed).length;
        });

        // Define threshold - this replaces the old hardcoded 10 stream limit
        const CONSUMER_THRESHOLD = 20; // Allow more consumers but manage dynamically

        if (totalActiveConsumers >= CONSUMER_THRESHOLD) {
            // Need to pause some low-priority streams to make room for speaking user
            await this.pauseLowPriorityStreamsForSpeaker(
                roomId,
                speakingPeerId,
                speakingStreams,
            );
        }
    }

    /**
     * ENHANCED: Pause low-priority streams to prioritize speaking user
     * This implements dynamic stream replacement based on speaking activity
     */
    private async pauseLowPriorityStreamsForSpeaker(
        roomId: string,
        speakingPeerId: string,
        speakingStreams: T.Stream[],
    ): Promise<void> {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) return;

        // Get all streams in room sorted by priority (speaking users first, then by age)
        const allRoomStreams = this.getStreamsByRoom(roomId);
        const prioritizedStreams = this.sortStreamsByPriority(
            allRoomStreams,
            roomId,
        );

        // Find streams that can be paused (not from special users, not currently speaking)
        const pausableStreams = prioritizedStreams.filter((stream) => {
            // Don't pause speaking user's own streams
            if (stream.publisherId === speakingPeerId) return false;

            // Don't pause streams from currently active speakers
            if (this.isUserSpeaking(roomId, stream.publisherId)) return false;

            // Don't pause special users (creators, admins, etc.) - extend this logic as needed
            if (this.isSpecialUser(roomId, stream.publisherId)) return false;

            // Check if stream has active consumers
            const consumers = mediaRoom.consumers.get(stream.streamId);
            return consumers && consumers.some((c) => !c.closed);
        });

        // Pause the lowest priority streams
        const streamsToPause = pausableStreams.slice(-speakingStreams.length); // Take the least priority ones

        for (const stream of streamsToPause) {
            await this.pauseStreamConsumers(stream.streamId, roomId);
        }
    }

    private sortStreamsByPriority(
        streams: T.Stream[],
        roomId: string,
    ): T.Stream[] {
        return streams.sort((a, b) => {
            // Priority 0: Screen share streams (absolute highest priority)
            const aIsScreenShare =
                a.metadata?.isScreenShare === true ||
                a.metadata?.type === 'screen' ||
                a.metadata?.type === 'screen_audio';
            const bIsScreenShare =
                b.metadata?.isScreenShare === true ||
                b.metadata?.type === 'screen' ||
                b.metadata?.type === 'screen_audio';
            if (aIsScreenShare && !bIsScreenShare) return -1;
            if (!aIsScreenShare && bIsScreenShare) return 1;

            // Priority 1: Currently speaking users
            const aIsSpeaking = this.isUserSpeaking(roomId, a.publisherId);
            const bIsSpeaking = this.isUserSpeaking(roomId, b.publisherId);
            if (aIsSpeaking && !bIsSpeaking) return -1;
            if (!aIsSpeaking && bIsSpeaking) return 1;

            // Priority 2: Translation streams (cabin users)
            const aIsTranslation =
                a.metadata?.isTranslation === true ||
                a.metadata?.type === 'translation';
            const bIsTranslation =
                b.metadata?.isTranslation === true ||
                b.metadata?.type === 'translation';
            if (aIsTranslation && !bIsTranslation) return -1;
            if (!aIsTranslation && bIsTranslation) return 1;

            // Priority 3: Other special users (creators, etc.)
            const aIsSpecial = this.isSpecialUser(roomId, a.publisherId);
            const bIsSpecial = this.isSpecialUser(roomId, b.publisherId);
            if (aIsSpecial && !bIsSpecial) return -1;
            if (!aIsSpecial && bIsSpecial) return 1;

            // Priority 4: Speaking priority metadata
            const aSpeakingPriority = a.metadata?.speakingPriority ? 1 : 0;
            const bSpeakingPriority = b.metadata?.speakingPriority ? 1 : 0;
            if (aSpeakingPriority !== bSpeakingPriority) {
                return bSpeakingPriority - aSpeakingPriority;
            }

            // FIX: Priority 5 - FIFO by timestamp (older streams first)
            // Extract timestamp from streamId format: "user1_video_1759990931787_i3cnx"
            const aTimestamp = this.extractTimestampFromStreamId(a.streamId);
            const bTimestamp = this.extractTimestampFromStreamId(b.streamId);

            if (aTimestamp !== bTimestamp) {
                return aTimestamp - bTimestamp; // Older first (FIFO)
            }

            // Fallback: Alphabetical order if timestamps are equal
            return a.streamId.localeCompare(b.streamId);
        });
    }

    /**
     * Extract timestamp from streamId
     * Format: "user1_video_1759990931787_i3cnx"
     *         [0]    [1]   [2]        [3]
     */
    private extractTimestampFromStreamId(streamId: string): number {
        try {
            const parts = streamId.split('_');
            if (parts.length >= 3) {
                const timestamp = parseInt(parts[2], 10);
                if (!isNaN(timestamp)) {
                    return timestamp;
                }
            }
        } catch (error) {
            logger.warn(
                'sfu.service.ts',
                `[SFU] Failed to extract timestamp from streamId: ${streamId}`,
            );
        }
        return 0; // Fallback to 0 if parsing fails
    }

    /**
     * ENHANCED: Check if user is special (creator, admin, etc.) or has special streams
     * Leverages existing metadata detection logic for optimal performance
     */
    private isSpecialUser(roomId: string, peerId: string): boolean {
        // Check if user has screen sharing streams (highest priority special user)
        const userStreams = this.getStreamsByRoom(roomId).filter(
            (stream) => stream.publisherId === peerId,
        );

        for (const stream of userStreams) {
            // Reuse existing screen share detection logic
            if (
                stream.metadata?.isScreenShare === true ||
                stream.metadata?.type === 'screen' ||
                stream.metadata?.type === 'screen_audio'
            ) {
                return true;
            }

            // Check for translation streams (cabin users)
            if (
                stream.metadata?.isTranslation === true ||
                stream.metadata?.type === 'translation'
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * ENHANCED: Pause consumers for a specific stream
     * This allows dynamic stream management without closing connections
     */
    /**
     * ENHANCED: Pause consumers for a specific stream
     * This allows dynamic stream management without closing connections
     */
    private async pauseStreamConsumers(
        streamId: string,
        roomId: string,
    ): Promise<void> {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) return;

        const consumers = mediaRoom.consumers.get(streamId);
        if (!consumers) return;

        for (const consumer of consumers) {
            // FIX: Check if already paused or closed before pausing
            if (consumer.closed) {
                continue; // Skip closed consumers
            }

            if (consumer.paused) {
                // Already paused, skip to avoid duplicate logs
                continue;
            }

            try {
                await consumer.pause();
                logger.info(
                    'sfu.service.ts',
                    `[SFU] Paused consumer ${consumer.id} for stream ${streamId}`,
                );
            } catch (error) {
                logger.error(
                    'sfu.service.ts',
                    `[SFU] Error pausing consumer ${consumer.id}`,
                    error,
                );
            }
        }
    }

    /**
     * ENHANCED: Clear speaking priority metadata from user's streams
     * This removes the temporary speaking priority when user stops speaking
     */
    private async clearSpeakingPriorityForUser(
        roomId: string,
        peerId: string,
    ): Promise<void> {
        const userStreams = this.getStreamsByRoom(roomId).filter(
            (stream) => stream.publisherId === peerId,
        );

        userStreams.forEach((stream) => {
            if (stream.metadata?.speakingPriority) {
                // Remove speaking priority metadata but keep other metadata
                const {
                    speakingPriority,
                    priorityTimestamp,
                    isFromSpeaking,
                    ...remainingMetadata
                } = stream.metadata;
                stream.metadata = remainingMetadata;

                // Update the stored stream
                this.streams.set(stream.streamId, stream);
            }
        });
    }

    /**
     * ENHANCED: Rebalance stream priorities after user stops speaking
     * This may resume previously paused streams or adjust consumer priorities
     */
    private async rebalanceStreamPrioritiesAfterSpeaking(
        roomId: string,
        stoppedSpeakingPeerId: string,
    ): Promise<void> {
        try {
            const mediaRoom = this.mediaRooms.get(roomId);
            if (!mediaRoom) return;

            // Step 1: Check if there are paused streams that can be resumed
            const allRoomStreams = this.getStreamsByRoom(roomId);
            const pausedStreams: T.Stream[] = [];

            // Find streams with paused consumers
            allRoomStreams.forEach((stream) => {
                const consumers = mediaRoom.consumers.get(stream.streamId);
                if (consumers) {
                    const hasPausedConsumers = consumers.some(
                        (c) => !c.closed && c.paused,
                    );
                    if (hasPausedConsumers) {
                        pausedStreams.push(stream);
                    }
                }
            });

            // Step 2: Get current priority list (now that speaking user is removed)
            const currentPriorityUsers = this.getPrioritizedUsers(roomId);

            // Step 3: Resume streams from users that are now in priority
            for (const stream of pausedStreams) {
                if (currentPriorityUsers.has(stream.publisherId)) {
                    await this.resumeStreamConsumers(stream.streamId, roomId);
                    logger.info(
                        'sfu.service.ts',
                        `[SFU] Resumed stream ${stream.streamId} from priority user ${stream.publisherId}`,
                    );
                }
            }
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                '[SFU] Error rebalancing stream priorities',
                error,
            );
        }
    }

    /**
     * ENHANCED: Resume consumers for a specific stream
     * This is the counterpart to pauseStreamConsumers
     */
    private async resumeStreamConsumers(
        streamId: string,
        roomId: string,
    ): Promise<void> {
        const mediaRoom = this.mediaRooms.get(roomId);
        if (!mediaRoom) return;

        const consumers = mediaRoom.consumers.get(streamId);
        if (!consumers) return;

        for (const consumer of consumers) {
            if (!consumer.closed && consumer.paused) {
                try {
                    await consumer.resume();
                    logger.info(
                        'sfu.service.ts',
                        `[SFU] Resumed consumer ${consumer.id} for stream ${streamId}`,
                    );
                } catch (error) {
                    logger.error(
                        'sfu.service.ts',
                        `[SFU] Error resuming consumer ${consumer.id}`,
                        error,
                    );
                }
            }
        }
    }

    // Translation Cabin Support Methods (Updated for bidirectional)
    async allocatePort(
        roomId: string,
        sourceUserId: string,
        targetUserId: string,
        sourceLanguage: string,
        targetLanguage: string,
        receivePort: number,
        sendPort: number, // Deprecated - no longer needed
        ssrc: number,
    ): Promise<{
        success: boolean;
        message?: string;
        streamId?: string;
        sfuListenPort?: number; // Return SFU listen port
        consumerSsrc?: number; // Return actual consumer SSRC for Audio routing
    }> {
        try {
            // New bidirectional translation system
            const result = await this.createBidirectionalTranslationTransports(
                roomId,
                sourceUserId,
                targetUserId,
                sourceLanguage,
                targetLanguage,
                receivePort,
                sendPort,
                ssrc,
            );

            return result;
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `[SFU Service] Error allocating port for ${targetUserId} in room ${roomId}`,
                error,
            );
            return {
                success: false,
                message: error.message || 'Failed to establish RTP connection',
            };
        }
    }

    // Enhanced Translation Cabin Support Methods
    async createBidirectionalTranslationTransports(
        roomId: string,
        sourceUserId: string,
        targetUserId: string,
        sourceLanguage: string,
        targetLanguage: string,
        receivePort: number,
        sendPort: number,
        ssrc: number,
    ): Promise<{
        success: boolean;
        message?: string;
        streamId?: string;
        sfuListenPort?: number; // Return SFU listen port for Audio Service
        consumerSsrc?: number; // Return actual consumer SSRC for Audio routing
    }> {
        try {
            const router = await this.getMediaRouter(roomId);

            // Create safe cabin identifiers using helper
            const cabinIds = createSafeCabinId(
                roomId,
                targetUserId,
                sourceLanguage,
                targetLanguage,
            );
            const {
                original: cabinId,
                safe: safeCabinId,
                components,
            } = cabinIds;
            const {
                safeRoomId,
                safeTargetUserId,
                safeSourceLanguage,
                safeTargetLanguage,
            } = components;

            // Check if cabin already exists
            if (this.translationCabins.has(cabinId)) {
                logger.info(
                    'sfu.service.ts',
                    `[SFU Service] Translation cabin already exists: ${cabinId}`,
                );
                const existing = this.translationCabins.get(cabinId);

                // Save user source to user consumer
                existing?.consumers.add(sourceUserId);

                return {
                    success: true,
                    message: 'Translation cabin already active',
                    streamId: existing?.streamId,
                    // Note: For existing cabins, we don't have the port info readily available
                };
            }

            const audioProducer = await this.findUserAudioProducer(
                roomId,
                targetUserId,
            );
            if (!audioProducer) {
                logger.error(
                    'sfu.service.ts',
                    `[SFU Service] No audio producer found for user ${targetUserId}`,
                );
                return {
                    success: false,
                    message: `No audio producer found for user ${targetUserId}`,
                };
            }

            // ============================================================================
            // NAT FIX: Create receiveTransport FIRST to get dynamic port
            // ============================================================================
            // Step 1: Create RECEIVE transport (Audio Service → SFU) FIRST
            const receiveTransport = await router.createPlainTransport({
                listenIp: {
                    ip:
                        this.configService.get('MEDIASOUP_LISTEN_IP') ||
                        '0.0.0.0',
                    announcedIp: this.configService.get(
                        'MEDIASOUP_ANNOUNCED_IP',
                    ),
                },
                rtcpMux: true,
                comedia: true, // Enable comedia for NAT traversal
                // No port specified → MediaSoup allocates dynamic port
            });

            // Get the actual port MediaSoup allocated
            const sfuListenPort = receiveTransport.tuple.localPort;
            logger.info(
                'sfu.service.ts',
                `[SFU Service] receiveTransport created on port ${sfuListenPort} (comedia mode - will learn address from first RTP)`,
            );

            // Log when receiveTransport learns remote address from first RTP packet
            receiveTransport.on('tuple', (tuple) => {
                logger.info(
                    'sfu.service.ts',
                    `[RTP-RX] ========== SFU ← AUDIO RTP RECEIVE ==========`,
                );
                logger.info(
                    'sfu.service.ts',
                    `[RTP-RX] Remote (Audio): ${tuple.remoteIp}:${tuple.remotePort}`,
                );
                logger.info(
                    'sfu.service.ts',
                    `[RTP-RX] Local (SFU):    ${tuple.localIp}:${tuple.localPort}`,
                );
                logger.info(
                    'sfu.service.ts',
                    `[RTP-RX] Protocol:       ${tuple.protocol}`,
                );
                logger.info(
                    'sfu.service.ts',
                    `[RTP-RX] ==============================================`,
                );
            });

            // DO NOT connect receiveTransport when comedia=true
            // MediaSoup will automatically learn the remote address from the first RTP packet
            // await receiveTransport.connect({}); // REMOVED - causes "missing port" error

            // Step 2: Create SEND transport (SFU → Audio Service)
            const sendTransport = await router.createPlainTransport({
                listenIp: {
                    ip:
                        this.configService.get('MEDIASOUP_LISTEN_IP') ||
                        '0.0.0.0',
                    announcedIp: this.configService.get(
                        'MEDIASOUP_ANNOUNCED_IP',
                    ),
                },
                rtcpMux: true,
                comedia: false, // Active connect to Audio Service
            });

            // Connect to Audio Service's SharedSocketManager fixed port (35000)
            // Use receivePort from Audio Service (should be SHARED_SOCKET_PORT = 35000)
            await sendTransport.connect({
                ip: this.configService.get('AUDIO_SERVICE_HOST') || 'localhost',
                port: receivePort, // Use the port from Audio Service allocation
            });

            // Step 3: Create consumer on send transport
            const consumer = await sendTransport.consume({
                producerId: audioProducer.id,
                rtpCapabilities: router.rtpCapabilities,
            });

            await consumer.resume();

            // Get consumer SSRC - this is the SSRC that Audio Service will use to send RTP back
            const consumerSsrc =
                consumer.rtpParameters.encodings?.[0]?.ssrc || ssrc;

            logger.info(
                'sfu.service.ts',
                `[SFU Service] Consumer created with SSRC: ${consumerSsrc} (original ssrc: ${ssrc})`,
            );

            // Step 4: Create producer on receiveTransport for translated audio
            // IMPORTANT: Use consumerSsrc, not the original ssrc from Audio Service
            // Audio Service will send RTP packets with consumerSsrc after receiving it
            const translatedProducer = await receiveTransport.produce({
                kind: 'audio',
                rtpParameters: {
                    mid: `translated_${safeRoomId}_${Date.now()}`, // Use safe identifier
                    codecs: [
                        {
                            mimeType: 'audio/opus',
                            clockRate: 48000,
                            channels: 2,
                            payloadType: 100,
                        },
                    ],
                    headerExtensions: [],
                    encodings: [{ ssrc: consumerSsrc }], // Use consumerSsrc - this matches what Audio Service sends
                    rtcp: {
                        cname: `translated_${safeTargetUserId}_${safeSourceLanguage}_${safeTargetLanguage}`, // Use safe identifier
                    },
                },
            });

            logger.info(
                'sfu.service.ts',
                `[SFU Service] TranslatedProducer created with SSRC: ${consumerSsrc}`,
            );

            // Step 5: Generate unique streamId for translated audio
            const translatedStreamId = createSafeTranslatedStreamId(
                roomId,
                sourceLanguage,
                targetLanguage,
            );

            // Step 6: Register translated audio as new stream
            const translatedStream: T.Stream = {
                streamId: translatedStreamId,
                publisherId: targetUserId,
                producerId: translatedProducer.id,
                metadata: {
                    type: 'translated_audio',
                    isTranslation: true,
                    sourceUserId: sourceUserId, // Người nói gốc
                    targetUserId: targetUserId, // Người nhận translation
                    originalUserId: targetUserId, // Backward compatibility
                    sourceLanguage,
                    targetLanguage,
                },
                rtpParameters: translatedProducer.rtpParameters,
                roomId: roomId,
                kind: 'audio',
                appData: {
                    type: 'translated_audio',
                    originalUserId: targetUserId,
                    targetUserId: targetUserId,
                    sourceLanguage,
                    targetLanguage,
                },
                created_at: new Date(),
            };

            // Save stream and producer mappings
            this.saveStream(translatedStream);
            this.saveProducer(roomId, translatedStreamId, translatedProducer);
            this.saveProducerToStream(translatedProducer.id, translatedStream);

            // Store cabin info for management
            this.translationCabins.set(cabinId, {
                receiveTransport,
                sendTransport,
                consumer,
                producer: translatedProducer,
                streamId: translatedStreamId,
                sourceUserId,
                targetUserId,
                sourceLanguage,
                targetLanguage,
                consumers: new Set<string>([sourceUserId]),
                createdAt: new Date(),
            });

            logger.info(
                'sfu.service.ts',
                `[SFU Service] ✅ Translation cabin created: ${cabinId}, SFU listen port: ${sfuListenPort}, consumer SSRC: ${consumerSsrc}`,
            );

            return {
                success: true,
                message:
                    'Bidirectional translation system created successfully',
                streamId: translatedStreamId,
                sfuListenPort, // Return port for Audio Service to send RTP to
                consumerSsrc, // Return actual consumer SSRC for Audio routing
            };
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `[SFU Service] Error creating bidirectional translation for ${targetUserId}`,
                error,
            );
            return {
                success: false,
                message:
                    error.message ||
                    'Failed to create bidirectional translation',
            };
        }
    }

    private async findUserAudioProducer(
        roomId: string,
        userId: string,
    ): Promise<mediasoupTypes.Producer | null> {
        try {
            const mediaRoom = this.mediaRooms.get(roomId);
            if (!mediaRoom) {
                logger.info(
                    'sfu.service.ts',
                    `[SFU] Media room ${roomId} not found`,
                );
                return null;
            }

            // Look for audio producer by finding a streamId that belongs to this peerId and is audio
            let audioProducer: mediasoupTypes.Producer | undefined;
            let audioStreamId: string | undefined;

            for (const [streamId, producer] of mediaRoom.producers.entries()) {
                // Check if this stream belongs to the userId and is audio
                if (
                    streamId.startsWith(`${userId}_audio_`) &&
                    producer.kind === 'audio'
                ) {
                    audioProducer = producer;
                    audioStreamId = streamId;
                    break;
                }
            }

            return audioProducer || null;
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `Error finding audio producer for user ${userId}`,
                error,
            );
            return null;
        }
    }

    /**
     * Destroys a translation cabin
     * @param data - The data for the translation cabin to destroy
     * @returns A promise indicating the success or failure of the operation
     */
    async destroyTranslationCabin(data: {
        room_id: string;
        source_user_id: string;
        target_user_id: string;
        source_language: string;
        target_language: string;
    }): Promise<{ success: boolean; message?: string }> {
        const cabinId = `${data.room_id}_${data.target_user_id}_${data.source_language}_${data.target_language}`;
        try {
            const cabin = this.translationCabins.get(cabinId);
            if (!cabin) {
                logger.info(
                    'sfu.service.ts',
                    `[SFU Service] Translation cabin ${cabinId} not found`,
                );
                return {
                    success: false,
                    message: 'Translation cabin not found',
                };
            }

            // Check if cabin is still being used before destroying
            // const isStillInUse = await this.isCabinStillInUse(
            //     cabinId,
            //     data.room_id,
            //     data.target_user_id,
            //     cabin,
            // );
            cabin.consumers.delete(data.source_user_id);
            const isStillInUse =
                this.translationCabins.has(cabinId) && cabin.consumers.size > 0;
            if (isStillInUse) {
                logger.info(
                    'sfu.service.ts',
                    `[SFU Service] Translation cabin ${cabinId} is still in use, skipping destruction`,
                );
                return {
                    success: true,
                    message: 'Translation cabin is still in use',
                };
            }

            // Close transports
            if (cabin.receiveTransport) {
                cabin.receiveTransport.close();
            }
            if (cabin.sendTransport) {
                cabin.sendTransport.close();
            }

            // Remove stream if exists
            if (cabin.streamId) {
                await this.removeProducer(data.room_id, cabin.streamId);
                this.removeStream(data.room_id, cabin.streamId);
            }

            // Remove from registry
            this.translationCabins.delete(cabinId);

            logger.info(
                'sfu.service.ts',
                `[SFU Service] Successfully destroyed translation cabin ${cabinId}`,
            );
            return {
                success: true,
                message: '10001', // 10001 is code in message from sfu to mark cabin is not use and destroy success
            };
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `[SFU Service] Error destroying translation cabin ${cabinId}`,
                error,
            );
            return {
                success: false,
                message: 'Failed to destroy translation cabin',
            };
        }
    }

    async listTranslationCabin(params: {
        roomId: string;
        userId: string;
    }): Promise<{
        success: boolean;
        cabins: {
            target_user_id: string;
            target_language: string;
            source_language: string;
        }[];
        message?: string;
    }> {
        try {
            const result = [] as {
                target_user_id: string;
                target_language: string;
                source_language: string;
            }[];

            // Filter theo cabin data thay vì parse cabinId
            for (const [cabinId, cabin] of this.translationCabins.entries()) {
                // Check nếu user này có trong consumers của cabin
                if (
                    cabin.consumers.has(params.userId) &&
                    cabinId.startsWith(params.roomId)
                ) {
                    result.push({
                        target_user_id: cabin.targetUserId,
                        target_language: cabin.targetLanguage,
                        source_language: cabin.sourceLanguage,
                    });
                }
            }

            return {
                success: true,
                cabins: result,
                message: 'Translation cabins listed successfully',
            };
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `[SFU Service] Error listing translation cabins`,
                error,
            );
            return {
                success: false,
                cabins: [],
                message: 'Failed to list translation cabins',
            };
        }
    }

    clearTranslationCabins(roomId: string): void {
        try {
            const cabinsToRemove: string[] = [];

            // Find all cabins for this room
            for (const [cabinId, cabin] of this.translationCabins.entries()) {
                if (cabinId.startsWith(roomId)) {
                    cabinsToRemove.push(cabinId);

                    logger.info(
                        'sfu.service.ts',
                        `[SFU Service] Cleaning up translation cabin: ${cabinId}`,
                    );

                    // Close transports
                    try {
                        if (
                            cabin.receiveTransport &&
                            !cabin.receiveTransport.closed
                        ) {
                            cabin.receiveTransport.close();
                        }
                    } catch (error) {
                        logger.error(
                            'sfu.service.ts',
                            `[SFU Service] Error closing receive transport for cabin ${cabinId}`,
                            error,
                        );
                    }

                    try {
                        if (
                            cabin.sendTransport &&
                            !cabin.sendTransport.closed
                        ) {
                            cabin.sendTransport.close();
                        }
                    } catch (error) {
                        logger.error(
                            'sfu.service.ts',
                            `[SFU Service] Error closing send transport for cabin ${cabinId}`,
                            error,
                        );
                    }

                    // Close consumer
                    try {
                        if (cabin.consumer && !cabin.consumer.closed) {
                            cabin.consumer.close();
                        }
                    } catch (error) {
                        logger.error(
                            'sfu.service.ts',
                            `[SFU Service] Error closing consumer for cabin ${cabinId}`,
                            error,
                        );
                    }

                    // Close producer
                    try {
                        if (cabin.producer && !cabin.producer.closed) {
                            cabin.producer.close();
                        }
                    } catch (error) {
                        logger.error(
                            'sfu.service.ts',
                            `[SFU Service] Error closing producer for cabin ${cabinId}`,
                            error,
                        );
                    }

                    // Remove stream if exists
                    if (cabin.streamId) {
                        try {
                            this.removeStream(roomId, cabin.streamId);

                            // Also remove from media room producers if exists
                            const mediaRoom = this.mediaRooms.get(roomId);
                            if (mediaRoom) {
                                mediaRoom.producers.delete(cabin.streamId);
                                mediaRoom.consumers.delete(cabin.streamId);
                            }
                        } catch (error) {
                            logger.error(
                                'sfu.service.ts',
                                `[SFU Service] Error removing stream ${cabin.streamId} for cabin ${cabinId}`,
                                error,
                            );
                        }
                    }

                    // Clear consumers set
                    cabin.consumers.clear();
                }
            }

            // Remove all cabins for this room
            cabinsToRemove.forEach((cabinId) => {
                this.translationCabins.delete(cabinId);
            });

            if (cabinsToRemove.length > 0) {
                logger.info(
                    'sfu.service.ts',
                    `[SFU Service] Successfully cleaned up ${cabinsToRemove.length} translation cabins for room ${roomId}`,
                );
            }
        } catch (error) {
            logger.error(
                'sfu.service.ts',
                `[SFU Service] Error clearing translation cabins for room ${roomId}`,
                error,
            );
        }
    }

    /**
     * Clear all pins for a user (called when user leaves room)
     */
    clearPinsForUser(roomId: string, userId: string): void {
        const roomPins = this.pinnedUsers.get(roomId);
        if (!roomPins) return;

        // Remove user as consumer (clear their pin list)
        roomPins.delete(userId);

        // Remove user from other users' pin lists (if they pinned this user)
        for (const [consumerId, userPins] of roomPins.entries()) {
            userPins.delete(userId);
        }

        logger.info(
            'sfu.service.ts',
            `[SFU] Cleared all pins for user ${userId} in room ${roomId}`,
        );
    }

    /**
     * Clear all pins for a room (called when room is destroyed)
     */
    clearPinsForRoom(roomId: string): void {
        this.pinnedUsers.delete(roomId);
        logger.info(
            'sfu.service.ts',
            `[SFU] Cleared all pins for room ${roomId}`,
        );
    }

    /**
     * Get all pinned users for a consumer
     */
    getPinnedUsersForConsumer(roomId: string, consumerId: string): string[] {
        const roomPins = this.pinnedUsers.get(roomId);
        if (!roomPins) return [];

        const userPins = roomPins.get(consumerId);
        return userPins ? Array.from(userPins) : [];
    }
}
