import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mediasoupTypes, { AppData } from 'mediasoup/node/lib/types';
import * as T from './interface';
import { WorkerPoolService } from './worker-pool/worker-pool.service';

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
    ) {
        // Kích hoạt task cleanup cho active speakers
        setInterval(() => this.cleanupInactiveSpeakers(), 5000);
    }
    async onModuleInit() {
        try {
            await this.initializeMediasoup();
        } catch (error) {
            console.error('SfuService: Failed to initialize:', error);
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
                console.error(
                    'Main mediasoup worker died, exiting in 2 seconds...',
                );
                setTimeout(() => process.exit(1), 2000);
            });
        } catch (error) {
            console.error(
                'Failed to create mediasoup worker or WebRTC server:',
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
            console.error(
                `Failed to create WebRTC transport in room ${roomId}:`,
                error,
            );
            throw error;
        }
    }

    async getIceServers() {
        if (this.configService.get('USE_ICE_SERVERS') == 'true') {
            return [
                {
                    urls:
                        this.configService.get('STUN_SERVER_URL') ||
                        'stun:stun.l.google.com:19302',
                    username: '',
                    credential: '',
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
            console.error('canConsume() error:', error);
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

    // Priority stream management - only first 10 streams get consumed
    getPriorityStreams(roomId: string): T.Stream[] {
        return this.getStreamsByRoom(roomId)
            .sort((a, b) => a.streamId.localeCompare(b.streamId))
            .slice(0, 10);
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
            console.warn(`Stream with ID ${streamId} does not exist.`);
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
        console.warn(`Stream with ID ${streamId} does not exist.`);
        return false;
    }

    saveProducerToStream(producerId: string, stream: T.Stream): boolean {
        const hasStream = this.streams.get(stream.streamId);
        if (!hasStream) {
            console.warn(`Stream with ID ${stream.streamId} does not exist.`);
            return false;
        }
        this.producerToStream.set(producerId, stream);
        return true;
    }

    // Stream prioritization logic from old code
    private shouldUserReceiveStream(
        roomId: string,
        consumerId: string,
        publisherId: string,
    ): boolean {
        // Sử dụng logic từ mã cũ để kiểm tra xem user có nên nhận stream này không
        const prioritizedUsers = this.getPrioritizedUsers(roomId);
        return prioritizedUsers.has(publisherId);
    }

    private getPrioritizedUsers(roomId: string): Set<string> {
        const prioritizedUsers = new Set<string>();

        // Logic từ mã cũ: chỉ cho phép 10 stream đầu tiên được consume
        const roomStreams = Array.from(this.streams.values())
            .filter((stream) => stream.roomId === roomId)
            .sort((a, b) => {
                // Sắp xếp theo thời gian tạo (dựa trên streamId có timestamp)
                return a.streamId.localeCompare(b.streamId);
            })
            .slice(0, 10); // Chỉ lấy 10 stream đầu tiên

        roomStreams.forEach((stream) => {
            prioritizedUsers.add(stream.publisherId);
        });
        return prioritizedUsers;
    }

    //TODO: Additional method to get recent speakers (from old code)
    private getRecentSpeakers(roomId: string, limit: number): string[] {
        // Logic này có thể được mở rộng để track speaking activity
        // Hiện tại chỉ return empty array
        return [];
    }

    // Method to notify user about stream changes (from old code)
    private notifyUserStreamChanges(roomId: string, userId: string): void {
        // Logic này có thể được mở rộng để notify qua WebSocket
    }

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

            // Check if user should receive this stream
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
                        'Stream not in priority list - only first 10 streams are consumed',
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
            };
        } catch (error) {
            console.error(`[SFU] Failed to create consumer:`, error);
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
            console.error(
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
            let streamId = `${data.participant.peerId || data.participant.peer_id}_${streamType}_${timestamp}_${randomSuffix}`;

            // Ensure streamId is unique
            let counter = 0;
            while (this.streams.has(streamId) && counter < 10) {
                counter++;
                const newRandomSuffix = Math.random().toString(36).substr(2, 5);
                streamId = `${data.participant.peerId || data.participant.peer_id}_${streamType}_${timestamp}_${newRandomSuffix}_${counter}`;
            }

            // Store producer in media room
            mediaRoom.producers.set(streamId, producer);

            // Create and store the stream object
            const stream = this.createStream(
                streamId,
                data.participant.peerId || data.participant.peer_id,
                producer.id,
                data.rtpParameters,
                data.metadata,
                data.roomId,
            );

            // Log priority information (từ mã cũ)
            const totalStreams = this.getStreamsByRoom(data.roomId).length;
            const isInPriority = this.isStreamInPriority(data.roomId, streamId);

            // Notify about stream changes
            this.notifyUserStreamChanges(
                data.roomId,
                data.participant.peerId || data.participant.peer_id,
            );

            return {
                producer,
                producerId: producer.id,
                streamId: streamId,
                isPriority: isInPriority,
                totalStreams: totalStreams,
            };
        } catch (error) {
            console.error(`[SFU] Failed to create producer:`, error);
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

    // Pin/Unpin logic methods
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
    }> {
        try {
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

            if (isAlreadyPriority) {
                return {
                    success: true,
                    message: `User ${pinnedPeerId} is already in priority`,
                    alreadyPriority: true,
                    consumersCreated: [],
                };
            }

            // Create consumers for all streams from pinned user
            const consumersCreated: any[] = [];
            const participant = { peerId: pinnerPeerId, peer_id: pinnerPeerId };

            for (const stream of pinnedUserStreams) {
                try {
                    const consumerResult = await this.createConsumer(
                        roomId,
                        stream.streamId,
                        transportId,
                        rtpCapabilities,
                        participant,
                    );

                    if (consumerResult.consumer) {
                        consumersCreated.push({
                            streamId: stream.streamId,
                            consumerId: consumerResult.consumer.id,
                            kind: consumerResult.kind,
                            rtpParameters: consumerResult.rtpParameters,
                            producerId: consumerResult.producerId,
                        });
                    }
                } catch (error) {
                    console.error(
                        `[SFU] Failed to create consumer for pinned stream ${stream.streamId}:`,
                        error,
                    );
                }
            }

            return {
                success: true,
                message: `Successfully pinned user ${pinnedPeerId}`,
                consumersCreated,
                alreadyPriority: false,
            };
        } catch (error) {
            console.error(`[SFU] Error in pinUser:`, error);
            return {
                success: false,
                message: `Failed to pin user: ${error.message}`,
            };
        }
    }

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
            // Get all streams from the unpinned user
            const unpinnedUserStreams = this.getStreamsByRoom(roomId).filter(
                (stream) => stream.publisherId === unpinnedPeerId,
            );

            if (unpinnedUserStreams.length === 0) {
                return {
                    success: false,
                    message: `No streams found for user ${unpinnedPeerId}`,
                };
            }

            // Check if unpinned user is still in priority (top 10)
            const priorityStreams = this.getPriorityStreams(roomId);
            const isStillInPriority = unpinnedUserStreams.some((stream) =>
                priorityStreams.some((p) => p.streamId === stream.streamId),
            );

            if (isStillInPriority) {
                return {
                    success: true,
                    message: `User ${unpinnedPeerId} is still in priority`,
                    stillInPriority: true,
                    consumersRemoved: [],
                };
            }

            // Remove consumers for all streams from unpinned user
            const mediaRoom = this.mediaRooms.get(roomId);
            if (!mediaRoom) {
                throw new Error(`Media room ${roomId} not found`);
            }

            const consumersRemoved: string[] = [];

            for (const stream of unpinnedUserStreams) {
                const consumers = mediaRoom.consumers.get(stream.streamId);
                if (consumers) {
                    // Find consumers belonging to the unpinner
                    const unpinnerConsumers = consumers.filter((consumer) => {
                        // You might need to track consumer ownership
                        // For now, we'll remove all consumers for this stream
                        return true;
                    });

                    for (const consumer of unpinnerConsumers) {
                        try {
                            consumer.close();
                            consumersRemoved.push(consumer.id);
                        } catch (error) {
                            console.error(
                                `[SFU] Failed to close consumer ${consumer.id}:`,
                                error,
                            );
                        }
                    }

                    // Remove closed consumers from the list
                    const remainingConsumers = consumers.filter(
                        (c) => !unpinnerConsumers.includes(c),
                    );
                    if (remainingConsumers.length > 0) {
                        mediaRoom.consumers.set(
                            stream.streamId,
                            remainingConsumers,
                        );
                    } else {
                        mediaRoom.consumers.delete(stream.streamId);
                    }
                }
            }

            return {
                success: true,
                message: `Successfully unpinned user ${unpinnedPeerId}`,
                consumersRemoved,
                stillInPriority: false,
            };
        } catch (error) {
            console.error(`[SFU] Error in unpinUser:`, error);
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
        console.log(
            `[SFU] Handling speaking for ${peerId} in room ${roomId} with port ${request.port}`,
        );
        try {
            if (!this.activeSpeakers.has(roomId)) {
                this.activeSpeakers.set(roomId, new Map());
            }

            const roomSpeakers = this.activeSpeakers.get(roomId);
            if (roomSpeakers) {
                roomSpeakers.set(peerId, new Date());
                console.log(
                    `[SFU] Updated speaker ${peerId} in room ${roomId}`,
                );
            }

            return { status: 'success', message: 'Speaker updated' };
        } catch (error) {
            console.error(
                `[SFU] Error handling speaking for ${peerId} in room ${roomId}:`,
                error,
            );
            return {
                status: 'error',
                message: `Failed to update speaker: ${error.message}`,
            };
        }
    }

    // HAndle stop speaking request
    async handleStopSpeaking(
        request: T.HandleStopSpeakingRequest,
    ): Promise<T.HandleStopSpeakingResponse> {
        const roomId = request.room_id;
        const peerId = request.peer_id;
        console.log(
            `[SFU] Handling stop speaking for ${peerId} in room ${roomId}`,
        );
        try {
            if (this.activeSpeakers.has(roomId)) {
                const roomSpeakers = this.activeSpeakers.get(roomId);
                if (roomSpeakers && roomSpeakers.has(peerId)) {
                    // Remove the peer from the speaking list
                    roomSpeakers.delete(peerId);
                    console.log(
                        `[SFU] Removed ${peerId} from active speakers in room ${roomId}`,
                    );
                }
            }

            return { status: 'success', message: 'Speaker stopped' };
        } catch (error) {
            console.error(
                `[SFU] Error handling stop speaking for ${peerId} in room ${roomId}:`,
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
                const currentTime = new Date();
                const speakThreshold = 2000; // 2 giây

                roomSpeakers?.forEach((lastSpeakTime, peerId) => {
                    if (
                        currentTime.getTime() - lastSpeakTime.getTime() <
                        speakThreshold
                    ) {
                        activeSpeakers.push({
                            peer_id: peerId,
                            last_speak_time: lastSpeakTime.getTime().toString(),
                        });
                    }
                });
            }

            return { active_speakers: activeSpeakers };
        } catch (error) {
            console.error(
                `[SFU] Error getting active speakers for room ${roomId}:`,
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
        if (!roomSpeakers || !roomSpeakers.has(peerId)) {
            return false;
        }

        const lastSpeakTime = roomSpeakers.get(peerId)!;
        const currentTime = new Date();
        const speakThreshold = 2000; // 2 giây

        return currentTime.getTime() - lastSpeakTime.getTime() < speakThreshold;
    }

    private cleanupInactiveSpeakers() {
        const currentTime = new Date();
        const inactivityThreshold = 5000; // 5s
        let totalCleaned = 0;
        let roomsCleaned = 0;

        this.activeSpeakers.forEach((roomSpeakers, roomId) => {
            const inactiveSpeakers: string[] = [];

            roomSpeakers.forEach((lastSpeakTime, peerId) => {
                if (
                    currentTime.getTime() - lastSpeakTime.getTime() >
                    inactivityThreshold
                ) {
                    inactiveSpeakers.push(peerId);
                }
            });

            // Delete inactive speakers
            inactiveSpeakers.forEach((peerId) => {
                roomSpeakers.delete(peerId);
                totalCleaned++;
            });

            // Delete room if no one is speaking
            // if (roomSpeakers.size === 0) {
            //   this.activeSpeakers.delete(roomId);
            //   roomsCleaned++;
            // }
        });
    }

    // Translation Cabin Support Methods (Updated for bidirectional)
    async allocatePort(
        roomId: string,
        sourceUserId: string,
        targetUserId: string,
        sourceLanguage: string,
        targetLanguage: string,
        receivePort: number,
        sendPort: number, // Optional for backward compatibility
        ssrc: number, // Optional SSRC for translation cabin
    ): Promise<{
        success: boolean;
        message?: string;
        streamId?: string;
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
            console.error(
                `[SFU Service] Error allocating port for ${targetUserId} in room ${roomId}:`,
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
    }> {
        try {
            const router = await this.getMediaRouter(roomId);
            const cabinId = `${roomId}_${targetUserId}_${sourceLanguage}_${targetLanguage}`;

            // Check if cabin already exists
            if (this.translationCabins.has(cabinId)) {
                console.log(
                    `[SFU Service] Translation cabin already exists: ${cabinId}`,
                );
                const existing = this.translationCabins.get(cabinId);

                // Save user source to user consumer
                existing?.consumers.add(sourceUserId);

                // Ensure streamId is properly set (fallback generation if missing)
                // let existingStreamId = existing?.streamId;
                // if (!existingStreamId) {
                //     existingStreamId = `translated_${targetUserId}_${sourceLanguage}_${targetLanguage}`;
                //     console.log(
                //         `[SFU Service] Generated missing streamId: ${existingStreamId}`,
                //     );

                //     // Update the cabin with the generated streamId
                //     if (existing) {
                //         existing.streamId = existingStreamId;
                //         this.translationCabins.set(cabinId, existing);
                //     }
                // }

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
                console.error(
                    `[SFU Service] No audio producer found for user ${targetUserId}`,
                );
                return {
                    success: false,
                    message: `No audio producer found for user ${targetUserId}`,
                };
            }

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
                comedia: false,
            });

            // Connect to Audio Service's SharedSocketManager fixed port (35000)
            const audioServiceRxPort = 35000; // Fixed port where Audio Service receives RTP
            await sendTransport.connect({
                ip: this.configService.get('AUDIO_SERVICE_HOST') || 'localhost',
                port: audioServiceRxPort,
            });

            // Step 3: Create consumer on receive transport
            const consumer = await sendTransport.consume({
                producerId: audioProducer.id,
                rtpCapabilities: router.rtpCapabilities,
            });

            await consumer.resume();

            // Step 4: Create SEND transport (Audio Service → SFU)
            // Use comedia: true only for receiveTransport to handle dynamic source ports
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
                comedia: true, // Enable comedia for receiveTransport to handle Audio Service's dynamic TX port
                port: sendPort, // This is the port Audio Service will send RTP to
            });

            // Connect receiveTransport - with comedia: true, no need to specify source details
            await receiveTransport.connect({});

            // Step 5: Create producer on send transport for translated audio
            const translatedProducer = await receiveTransport.produce({
                kind: 'audio',
                rtpParameters: {
                    mid: `translated_${cabinId}`,
                    codecs: [
                        {
                            mimeType: 'audio/opus',
                            clockRate: 48000,
                            channels: 2,
                            payloadType: 100,
                        },
                    ],
                    headerExtensions: [],
                    encodings: [{ ssrc: ssrc }], // Use SSRC from Audio Service
                    rtcp: {
                        cname: `translated_${targetUserId}`,
                    },
                },
            });

            // Step 6: Generate streamId for translated audio
            const translatedStreamId = `translated_${targetUserId}_${sourceLanguage}_${targetLanguage}`;

            // Step 7: Register translated audio as new stream
            const translatedStream: T.Stream = {
                streamId: translatedStreamId,
                publisherId: targetUserId,
                producerId: translatedProducer.id,
                metadata: {
                    type: 'translated_audio',
                    originalUserId: targetUserId,
                    targetUserId: targetUserId,
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

            return {
                success: true,
                message:
                    'Bidirectional translation system created successfully',
                streamId: translatedStreamId,
            };
        } catch (error) {
            console.error(
                `[SFU Service] Error creating bidirectional translation for ${targetUserId}:`,
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
                console.log(`[SFU] Media room ${roomId} not found`);
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
            console.error(
                `Error finding audio producer for user ${userId}:`,
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
                console.log(
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
                console.log(
                    `[SFU Service] Translation cabin ${cabinId} is still in use, skipping destruction`,
                );
                return {
                    success: true,
                    message: 'Translation cabin is still in use',
                };
            }

            console.log(
                `[SFU Service] Destroying translation cabin ${cabinId}`,
            );

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

            console.log(
                `[SFU Service] Successfully destroyed translation cabin ${cabinId}`,
            );
            return {
                success: true,
                message: '10001', // 10001 is code in message from sfu to mark cabin is not use and destroy success
            };
        } catch (error) {
            console.error(
                `[SFU Service] Error destroying translation cabin ${cabinId}:`,
                error,
            );
            return {
                success: false,
                message: 'Failed to destroy translation cabin',
            };
        }
    }

    /**
     * Check if translation cabin is still being used by any participants
     */
    // private async isCabinStillInUse(
    //     cabinId: string,
    //     roomId: string,
    //     targetUserId: string,
    //     cabin: {
    //         receiveTransport: mediasoupTypes.PlainTransport;
    //         sendTransport: mediasoupTypes.PlainTransport;
    //         consumer: mediasoupTypes.Consumer;
    //         producer?: mediasoupTypes.Producer;
    //         streamId?: string;
    //     },
    // ): Promise<boolean> {
    //     try {
    //         const mediaRoom = this.mediaRooms.get(roomId);

    //         if (!mediaRoom || !cabin.streamId) {
    //             return false;
    //         }

    //         // Check if there are any active consumers for the translated stream
    //         const consumers = mediaRoom.consumers.get(cabin.streamId);
    //         if (consumers && consumers.length > 0) {
    //             // Filter out closed consumers
    //             const activeConsumers = consumers.filter(
    //                 (consumer) => !consumer.closed,
    //             );

    //             if (activeConsumers.length > 0) {
    //                 console.log(
    //                     `[SFU Service] Cabin ${cabinId} has ${activeConsumers.length} active consumers`,
    //                 );

    //                 // Update the consumers list to remove closed ones
    //                 if (activeConsumers.length < consumers.length) {
    //                     mediaRoom.consumers.set(
    //                         cabin.streamId,
    //                         activeConsumers,
    //                     );
    //                 }

    //                 return true;
    //             } else {
    //                 // All consumers are closed, clean up the consumers list
    //                 mediaRoom.consumers.delete(cabin.streamId);
    //             }
    //         }

    //         if (targetUserId) {
    //             const userStreams = this.getStreamsByRoom(roomId).filter(
    //                 (stream) => stream.publisherId === targetUserId,
    //             );

    //             if (userStreams.length === 0) {
    //                 console.log(
    //                     `[SFU Service] Original user ${targetUserId} no longer has streams in room ${roomId}`,
    //                 );
    //                 return false;
    //             }
    //         }

    //         // Check if the producer is still active
    //         if (cabin.producer && cabin.producer.closed) {
    //             console.log(
    //                 `[SFU Service] Cabin ${cabinId} producer is closed`,
    //             );
    //             return false;
    //         }

    //         return false;
    //     } catch (error) {
    //         console.error(
    //             `[SFU Service] Error checking cabin usage for ${cabinId}:`,
    //             error,
    //         );
    //         return false;
    //     }
    // }

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
            // Lấy ra thông tin từ cabinId ==> targetLanguage, sourceLanguage
            // const cabins = Array.from(this.translationCabins.keys());

            // const result = cabins
            //     .filter(
            //         (cabinId) =>
            //             cabinId.includes(params.roomId) &&
            //             cabinId.includes(params.userId),
            //     )
            //     .map((cabinId) => {
            //         return {
            //             target_user_id: cabinId.split('_')[2],
            //             target_language: cabinId.split('_')[3],
            //             source_language: cabinId.split('_')[4],
            //         };
            //     });
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
            console.error(
                `[SFU Service] Error listing translation cabins:`,
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

                    console.log(
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
                        console.error(
                            `[SFU Service] Error closing receive transport for cabin ${cabinId}:`,
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
                        console.error(
                            `[SFU Service] Error closing send transport for cabin ${cabinId}:`,
                            error,
                        );
                    }

                    // Close consumer
                    try {
                        if (cabin.consumer && !cabin.consumer.closed) {
                            cabin.consumer.close();
                        }
                    } catch (error) {
                        console.error(
                            `[SFU Service] Error closing consumer for cabin ${cabinId}:`,
                            error,
                        );
                    }

                    // Close producer
                    try {
                        if (cabin.producer && !cabin.producer.closed) {
                            cabin.producer.close();
                        }
                    } catch (error) {
                        console.error(
                            `[SFU Service] Error closing producer for cabin ${cabinId}:`,
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
                            console.error(
                                `[SFU Service] Error removing stream ${cabin.streamId} for cabin ${cabinId}:`,
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
                console.log(
                    `[SFU Service] Successfully cleaned up ${cabinsToRemove.length} translation cabins for room ${roomId}`,
                );
            }
        } catch (error) {
            console.error(
                `[SFU Service] Error clearing translation cabins for room ${roomId}:`,
                error,
            );
        }
    }
}
