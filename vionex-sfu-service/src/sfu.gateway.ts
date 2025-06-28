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
import { SfuService } from './sfu.service';
import { types as mediasoupTypes } from 'mediasoup';
import { Inject, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { RoomGrpcService } from './interface';
import { firstValueFrom } from 'rxjs';

interface Participant {
  socketId: string;
  peerId: string;
  rtpCapabilities?: mediasoupTypes.RtpCapabilities;
  transports: Map<string, mediasoupTypes.WebRtcTransport>;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
  isCreator: boolean;
  timeArrive: Date;
}

interface Stream {
  streamId: string;
  publisherId: string;
  producerId: string;
  metadata: any;
  rtpParameters: mediasoupTypes.RtpParameters;
  roomId: string;
}

@WebSocketGateway({
  port: 3005, // Direct SFU WebSocket port
  transports: ['websocket'],
  cors: { origin: '*', credentials: true },
  path: '/socket.io',
  serveClient: false,
  namespace: '/',
  // Listen on all interfaces
  allowEIO3: true,
})
export class SfuGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit
{
  @WebSocketServer() io: Server;

  private rooms = new Map<string, Map<string, Participant>>();
  private streams = new Map<string, Stream>();
  private producerToStream = new Map<string, Stream>();
  private roomService: RoomGrpcService;

  constructor(
    private readonly sfuService: SfuService,
    @Inject('ROOM_SERVICE') private readonly roomServiceClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.roomService =
      this.roomServiceClient.getService<RoomGrpcService>('RoomService');
  }

  afterInit(server: Server) {
    console.log('🚀 [SFU-WS] WebSocket Gateway initialized successfully');
    console.log('🚀 [SFU-WS] Server instance available:', !!server);
  }

  handleConnection(client: Socket) {
    console.log('✅ [SFU-WS] Client connected:', client.id);

    // Safe access to sockets count
    const totalClients = this.io?.sockets?.sockets?.size || 0;
    console.log('✅ [SFU-WS] Total connected clients:', totalClients);
    console.log('✅ [SFU-WS] Current rooms:', Array.from(this.rooms.keys()));
  }

  async handleDisconnect(client: Socket) {
    console.log('❌ [SFU-WS] Client disconnected:', client.id);

    // Safe access to sockets count
    const remainingClients = Math.max(
      0,
      (this.io?.sockets?.sockets?.size || 1) - 1,
    );
    console.log('❌ [SFU-WS] Remaining connected clients:', remainingClients);

    // Find the participant before cleanup
    const participant = this.getParticipantBySocketId(client.id);
    const roomId = participant ? this.getParticipantRoom(participant) : null;

    console.log(
      `❌ [SFU-WS] Disconnecting participant: ${participant?.peerId} from room: ${roomId}`,
    );
    console.log(`❌ [SFU-WS] Participant object:`, participant);

    // Call room service to remove participant from persistent room state
    if (participant && roomId) {
      try {
        console.log(
          `🔄 [SFU-WS] Calling room service to remove participant: ${participant.peerId} from room: ${roomId}`,
        );
        console.log(`🔄 [SFU-WS] Request data:`, {
          room_id: roomId,
          participant_id: participant.peerId,
          socket_id: client.id,
        });
        const roomResult = await firstValueFrom(
          this.roomService.leaveRoom({
            room_id: roomId,
            participant_id: participant.peerId,
            socket_id: client.id,
          }),
        );
        console.log(`✅ [SFU-WS] Room service response:`, roomResult);
      } catch (error) {
        console.error(
          `❌ [SFU-WS] Failed to remove participant from room service:`,
          error,
        );
      }
    } else {
      console.log(
        `⚠️ [SFU-WS] Cannot call room service - participant: ${!!participant}, roomId: ${roomId}`,
      );
    }

    // Cleanup participant from SFU in-memory state
    this.cleanupParticipant(client.id);

    // Log room state after cleanup
    if (roomId) {
      const room = this.rooms.get(roomId);
      console.log(
        `❌ [SFU-WS] Room ${roomId} participants after cleanup:`,
        Array.from(room?.keys() || []),
      );
      console.log(
        `❌ [SFU-WS] Room ${roomId} participant count: ${room?.size || 0}`,
      );
    }
  }

  private cleanupParticipant(socketId: string) {
    for (const [roomId, room] of this.rooms.entries()) {
      for (const [peerId, participant] of room.entries()) {
        if (participant.socketId === socketId) {
          console.log(
            `🧹 [SFU-WS] Cleaning up participant ${peerId} from room ${roomId}`,
          );

          // Close transports
          for (const transport of participant.transports.values()) {
            transport.close();
          }

          // Remove streams and notify other clients
          const removedStreams: string[] = [];
          for (const [streamId, stream] of this.streams.entries()) {
            if (stream.publisherId === peerId) {
              this.streams.delete(streamId);
              removedStreams.push(streamId);
              console.log(
                `🗑️ [SFU-WS] Removed stream: ${streamId} from ${peerId}`,
              );

              // Notify other clients about stream removal
              if (this.io) {
                this.io.to(roomId).emit('sfu:stream-removed', {
                  streamId,
                  publisherId: peerId,
                });
              }
            }
          }

          // Remove participant from room
          room.delete(peerId);
          console.log(
            `🗑️ [SFU-WS] Removed participant ${peerId} from room ${roomId}`,
          );
          console.log(
            `📊 [SFU-WS] Room ${roomId} remaining participants:`,
            Array.from(room.keys()),
          );

          // Notify other clients about peer leaving
          const peerLeftData = {
            peerId,
            roomId,
            removedStreams,
            timestamp: Date.now(),
          };

          console.log(
            `📢 [SFU-WS] Broadcasting peer-left to room ${roomId}:`,
            peerLeftData,
          );
          if (this.io) {
            this.io.to(roomId).emit('sfu:peer-left', peerLeftData);
          }

          // Check if room is empty and clean up if needed
          if (room.size === 0) {
            console.log(
              `🏠 [SFU-WS] Room ${roomId} is now empty, keeping for potential reconnections`,
            );
          }

          return; // Found and cleaned up the participant
        }
      }
    }
    console.log(`⚠️ [SFU-WS] No participant found for socket ${socketId}`);
  }

  @SubscribeMessage('sfu:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; peerId: string; password?: string },
  ) {
    const { roomId, peerId } = data;
    console.log(`🚪 [SFU-WS] Join request: ${peerId} → ${roomId}`);
    console.log(
      `🚪 [SFU-WS] Current rooms in memory:`,
      Array.from(this.rooms.keys()),
    );
    console.log(`🚪 [SFU-WS] Total streams in memory:`, this.streams.size);

    try {
      console.log(
        `🚪 [SFU-WS] Joining client ${client.id} to socket room ${roomId}`,
      );
      client.join(roomId);
      console.log(
        `🚪 [SFU-WS] Client ${client.id} joined socket room, rooms:`,
        Array.from(client.rooms),
      );

      // Initialize room if needed
      if (!this.rooms.has(roomId)) {
        console.log(`🏠 [SFU-WS] Creating new room: ${roomId}`);
        this.rooms.set(roomId, new Map());
        await this.sfuService.createMediaRoom(roomId);
      } else {
        console.log(`🏠 [SFU-WS] Room ${roomId} already exists`);
      }

      const room = this.rooms.get(roomId);
      const isCreator = room?.size === 0;

      console.log(
        `🏠 [SFU-WS] Room ${roomId} current participants:`,
        Array.from(room?.keys() || []),
      );
      console.log(`🏠 [SFU-WS] Is ${peerId} creator: ${isCreator}`);

      // Check if username already taken
      if (room?.has(peerId)) {
        console.log(
          `❌ [SFU-WS] Username ${peerId} already taken in room ${roomId}`,
        );
        client.emit('sfu:error', {
          message: 'Username already in use',
          code: 'USERNAME_TAKEN',
        });
        return;
      }

      // Create participant
      const participant: Participant = {
        socketId: client.id,
        peerId,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        isCreator: isCreator || false,
        timeArrive: new Date(),
      };

      room?.set(peerId, participant);

      // Send join success
      client.emit('sfu:join-success', {
        peerId,
        roomId,
        isCreator: participant.isCreator,
      });

      // Automatically send router RTP capabilities after join
      const router = await this.sfuService.getMediaRouter(roomId);
      client.emit('sfu:router-capabilities', {
        routerRtpCapabilities: router.rtpCapabilities,
      });
      console.log(`📡 [SFU-WS] Auto-sent router capabilities to ${peerId}`);

      // Notify other peers about new join
      console.log(
        `👋 [SFU-WS] About to notify other peers about ${peerId} joining room ${roomId}`,
      );
      console.log(
        `👋 [SFU-WS] Room participants before broadcast:`,
        Array.from(room?.keys() || []),
      );
      console.log(
        `👋 [SFU-WS] Broadcasting to room ${roomId}, excluding new joiner ${peerId}`,
      );

      const newPeerData = {
        peerId,
        isCreator: participant.isCreator,
        timeArrive: participant.timeArrive,
      };

      console.log(`👋 [SFU-WS] New peer data:`, newPeerData);

      // Get all sockets in the room BEFORE broadcasting
      const socketsInRoomBeforeBroadcast = await this.io
        .in(roomId)
        .fetchSockets();
      console.log(
        `👋 [SFU-WS] Sockets in room ${roomId} before broadcast:`,
        socketsInRoomBeforeBroadcast.map((s) => s.id),
      );
      console.log(`👋 [SFU-WS] Current joining client socket: ${client.id}`);

      const otherSocketsInRoom = socketsInRoomBeforeBroadcast.filter(
        (s) => s.id !== client.id,
      );
      console.log(
        `👋 [SFU-WS] Other sockets that should receive new-peer-join: ${otherSocketsInRoom.length}`,
        otherSocketsInRoom.map((s) => s.id),
      );

      if (otherSocketsInRoom.length > 0) {
        console.log(
          `📢 [SFU-WS] Broadcasting new-peer-join to ${otherSocketsInRoom.length} clients`,
        );
        client.to(roomId).emit('sfu:new-peer-join', newPeerData);
        console.log(
          `✅ [SFU-WS] new-peer-join event broadcasted for ${peerId}`,
        );

        // Also emit to each socket individually for debugging
        for (const socket of otherSocketsInRoom) {
          socket.emit('sfu:new-peer-join', newPeerData);
          console.log(
            `📤 [SFU-WS] Sent new-peer-join directly to socket ${socket.id}`,
          );
        }
      } else {
        console.log(
          `⚠️ [SFU-WS] No other sockets in room to notify about new peer join!`,
        );
      }

      // Check if there are other clients to notify
      const otherParticipants = Array.from(room?.keys() || []).filter(
        (p) => p !== peerId,
      );
      console.log(
        `👋 [SFU-WS] Other participants who should receive new-peer-join: ${otherParticipants.length}`,
        otherParticipants,
      );

      // Send existing streams to new participant
      const existingStreams = Array.from(this.streams.values()).filter(
        (stream) => stream.roomId === roomId && stream.publisherId !== peerId,
      );

      console.log(
        `📺 [SFU-WS] Checking existing streams for new participant ${peerId}:`,
      );
      console.log(`📺 [SFU-WS] Total streams in memory: ${this.streams.size}`);
      console.log(
        `📺 [SFU-WS] All streams:`,
        Array.from(this.streams.values()).map((s) => ({
          streamId: s.streamId,
          publisherId: s.publisherId,
          roomId: s.roomId,
        })),
      );
      console.log(
        `📺 [SFU-WS] Streams for room ${roomId}:`,
        Array.from(this.streams.values()).filter((s) => s.roomId === roomId),
      );
      console.log(
        `📺 [SFU-WS] Filtered existing streams for ${peerId}: ${existingStreams.length}`,
        existingStreams.map((s) => ({
          streamId: s.streamId,
          publisherId: s.publisherId,
        })),
      );

      if (existingStreams.length > 0) {
        console.log(
          `📺 [SFU-WS] Sending ${existingStreams.length} existing streams to ${peerId}`,
        );
        for (const stream of existingStreams) {
          console.log(
            `📺 [SFU-WS] Sending stream: ${stream.streamId} from ${stream.publisherId} to ${peerId}`,
          );

          const streamData = {
            streamId: stream.streamId,
            publisherId: stream.publisherId,
            metadata: stream.metadata,
            rtpParameters: stream.rtpParameters,
          };

          console.log(`📺 [SFU-WS] Stream data being sent:`, streamData);

          client.emit('sfu:stream-added', streamData);

          console.log(
            `📺 [SFU-WS] Stream ${stream.streamId} sent to ${peerId}`,
          );
        }
      } else {
        console.log(`📺 [SFU-WS] No existing streams to send to ${peerId}`);
      }

      console.log(`✅ [SFU-WS] ${peerId} joined room ${roomId}`);
    } catch (error) {
      console.error('🚨 [SFU-WS] Join error:', error);
      client.emit('sfu:error', {
        message: 'Failed to join room',
        code: 'JOIN_ERROR',
      });
    }
  }

  @SubscribeMessage('sfu:get-rtpcapabilities')
  async handleGetRouterRtpCapabilities(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    try {
      console.log(
        `📡 [SFU-WS] RTP capabilities request for room: ${data.roomId}`,
      );
      const router = await this.sfuService.createMediaRoom(data.roomId);

      client.emit('sfu:router-capabilities', {
        routerRtpCapabilities: router.rtpCapabilities,
      });

      console.log(
        `✅ [SFU-WS] Sent router RTP capabilities for room: ${data.roomId}`,
      );
    } catch (error) {
      console.error('🚨 [SFU-WS] Failed to get router capabilities:', error);
      client.emit('sfu:error', {
        message: 'Failed to get router capabilities',
        code: 'ROUTER_ERROR',
      });
    }
  }

  @SubscribeMessage('sfu:set-rtp-capabilities')
  handleSetRtpCapabilities(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rtpCapabilities: mediasoupTypes.RtpCapabilities },
  ) {
    console.log(
      `📨 [SFU-WS] Received sfu:set-rtp-capabilities from client: ${client.id}`,
    );
    console.log(
      `📨 [SFU-WS] RTP capabilities data:`,
      JSON.stringify(data, null, 2),
    );

    const participant = this.getParticipantBySocketId(client.id);
    if (!participant) {
      console.log(`❌ [SFU-WS] Participant not found for socket: ${client.id}`);
      client.emit('sfu:error', {
        message: 'Participant not found',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    console.log(
      `📊 [SFU-WS] Setting RTP capabilities for: ${participant.peerId}`,
    );
    participant.rtpCapabilities = data.rtpCapabilities;

    console.log(
      `📡 [SFU-WS] Emitting sfu:rtp-capabilities-set to client: ${client.id}`,
    );
    client.emit('sfu:rtp-capabilities-set');
    console.log(`✅ [SFU-WS] sfu:rtp-capabilities-set sent successfully`);
  }

  @SubscribeMessage('sfu:create-transport')
  async handleCreateWebRtcTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; isProducer: boolean },
  ) {
    const participant = this.getParticipantBySocketId(client.id);
    if (!participant) {
      client.emit('sfu:error', {
        message: 'Participant not found',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    try {
      console.log(
        `🚛 [SFU-WS] Creating transport for ${participant.peerId}, isProducer: ${data.isProducer}`,
      );

      const transport = await this.sfuService.createWebRtcTransport(
        data.roomId,
      );

      transport.appData = {
        ...(transport.appData || {}),
        connected: false,
        isProducer: data.isProducer,
      };

      // Store transport
      participant.transports.set(transport.id, transport);

      // Handle transport close
      transport.on('routerclose', () => {
        console.log(
          `🚛 [SFU-WS] Transport ${transport.id} closed because router closed`,
        );
        transport.close();
        participant.transports.delete(transport.id);
      });

      const transportInfo = {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        isProducer: data.isProducer,
      };

      client.emit('sfu:transport-created', transportInfo);
      console.log(`✅ [SFU-WS] Transport created: ${transport.id}`);
    } catch (error) {
      console.error('🚨 [SFU-WS] Create transport error:', error);
      client.emit('sfu:error', {
        message: 'Failed to create transport',
        code: 'TRANSPORT_CREATE_ERROR',
      });
    }
  }

  @SubscribeMessage('sfu:connect-transport')
  async handleConnectTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      transportId: string;
      dtlsParameters: mediasoupTypes.DtlsParameters;
    },
  ) {
    const participant = this.getParticipantBySocketId(client.id);
    if (!participant) {
      client.emit('sfu:error', {
        message: 'Participant not found',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    const transport = participant.transports.get(data.transportId);
    if (!transport) {
      client.emit('sfu:error', {
        message: 'Transport not found',
        code: 'TRANSPORT_NOT_FOUND',
      });
      return;
    }

    try {
      console.log(`🔗 [SFU-WS] Connecting transport: ${data.transportId}`);

      // Check if already connected
      if (transport.appData && transport.appData.connected) {
        client.emit('sfu:transport-connected', {
          transportId: data.transportId,
        });
        return;
      }

      await transport.connect({ dtlsParameters: data.dtlsParameters });

      // Mark as connected
      transport.appData = {
        ...transport.appData,
        connected: true,
      };

      client.emit('sfu:transport-connected', { transportId: data.transportId });
      console.log(`✅ [SFU-WS] Transport connected: ${data.transportId}`);
    } catch (error) {
      console.error('🚨 [SFU-WS] Connect transport error:', error);
      client.emit('sfu:error', {
        message: 'Failed to connect transport',
        code: 'TRANSPORT_CONNECT_ERROR',
      });
    }
  }

  @SubscribeMessage('sfu:produce')
  async handleProduce(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      transportId: string;
      kind: mediasoupTypes.MediaKind;
      rtpParameters: mediasoupTypes.RtpParameters;
      metadata: any;
    },
  ) {
    console.log(`🎬 [SFU-WS] Produce request from ${client.id}:`, {
      transportId: data.transportId,
      kind: data.kind,
      metadata: data.metadata,
    });

    const participant = this.getParticipantBySocketId(client.id);
    if (!participant) {
      console.log(`🚨 [SFU-WS] Participant not found for socket ${client.id}`);
      client.emit('sfu:error', {
        message: 'Participant not found',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    console.log(`🎬 [SFU-WS] Found participant: ${participant.peerId}`);

    const roomId = this.getParticipantRoom(participant);
    if (!roomId) {
      console.log(
        `🚨 [SFU-WS] Room not found for participant ${participant.peerId}`,
      );
      client.emit('sfu:error', {
        message: 'Room not found',
        code: 'ROOM_NOT_FOUND',
      });
      return;
    }

    console.log(`🎬 [SFU-WS] Room found: ${roomId}`);

    const transport = participant.transports.get(data.transportId);
    if (!transport) {
      console.log(
        `🚨 [SFU-WS] Transport ${data.transportId} not found for ${participant.peerId}`,
      );
      client.emit('sfu:error', {
        message: 'Transport not found',
        code: 'TRANSPORT_NOT_FOUND',
      });
      return;
    }

    console.log(`🎬 [SFU-WS] Transport found: ${data.transportId}`);

    try {
      console.log(
        `🎬 [SFU-WS] Producing ${data.kind} for ${participant.peerId}`,
      );

      const producer = await transport.produce({
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      console.log(`🎬 [SFU-WS] Producer created successfully: ${producer.id}`);

      // Store producer
      participant.producers.set(producer.id, producer);

      // Create streamId
      const streamId = `${participant.peerId}-${data.metadata.type}-${Date.now()}`;

      // Create stream
      const stream: Stream = {
        streamId,
        publisherId: participant.peerId,
        producerId: producer.id,
        metadata: data.metadata,
        rtpParameters: data.rtpParameters,
        roomId: roomId,
      };

      this.streams.set(streamId, stream);
      this.producerToStream.set(producer.id, stream);

      console.log(
        `🎬 [SFU-WS] Stream created: ${streamId}, total streams: ${this.streams.size}`,
      );

      // Save producer in service
      this.sfuService.saveProducer(roomId, streamId, producer);

      // Handle producer close
      producer.on('transportclose', () => {
        console.log(`🎬 [SFU-WS] Producer ${producer.id} closed`);
        this.sfuService.removeProducer(roomId, streamId);
        participant.producers.delete(producer.id);
        this.streams.delete(streamId);
      });

      // Response to client
      client.emit('sfu:producer-created', {
        producerId: producer.id,
        streamId,
      });

      console.log(
        `📺 [SFU-WS] Broadcasting stream-added to room ${roomId}, excluding ${participant.peerId}`,
      );
      console.log(
        `📺 [SFU-WS] Room participants:`,
        Array.from(this.rooms.get(roomId)?.keys() || []),
      );
      console.log(
        `📺 [SFU-WS] Socket rooms for client ${client.id}:`,
        Array.from(client.rooms),
      );

      // Get all sockets in the room
      const socketsInRoom = await this.io.in(roomId).fetchSockets();
      console.log(
        `📺 [SFU-WS] Sockets in room ${roomId}:`,
        socketsInRoom.map((s) => s.id),
      );
      console.log(`📺 [SFU-WS] Current client socket ID: ${client.id}`);

      const streamAddedData = {
        streamId,
        publisherId: participant.peerId,
        metadata: data.metadata,
        rtpParameters: data.rtpParameters,
      };

      console.log(
        `📺 [SFU-WS] About to broadcast stream-added:`,
        streamAddedData,
      );
      console.log(
        `📺 [SFU-WS] Broadcasting to room ${roomId}, excluding producer ${participant.peerId}`,
      );

      // Get fresh list of sockets in room for stream broadcast
      const socketsInRoomForStream = await this.io.in(roomId).fetchSockets();
      console.log(
        `📺 [SFU-WS] Fresh sockets in room ${roomId}:`,
        socketsInRoomForStream.map((s) => s.id),
      );

      const otherClientsInRoom = socketsInRoomForStream.filter(
        (s) => s.id !== client.id,
      );
      console.log(
        `📺 [SFU-WS] Stream-added should be received by ${otherClientsInRoom.length} clients:`,
        otherClientsInRoom.map((s) => s.id),
      );

      if (otherClientsInRoom.length > 0) {
        console.log(
          `📢 [SFU-WS] Broadcasting stream-added to ${otherClientsInRoom.length} clients`,
        );
        // Broadcast to other clients
        client.to(roomId).emit('sfu:stream-added', streamAddedData);
        console.log(
          `📺 [SFU-WS] Stream-added event broadcasted for stream ${streamId}`,
        );

        // Also emit to each socket individually for debugging
        for (const socket of otherClientsInRoom) {
          socket.emit('sfu:stream-added', streamAddedData);
          console.log(
            `📤 [SFU-WS] Sent stream-added directly to socket ${socket.id}`,
          );
        }
      } else {
        console.log(
          `⚠️ [SFU-WS] No other clients in room to receive stream-added event!`,
        );
      }

      console.log(
        `✅ [SFU-WS] Producer created: ${producer.id} → Stream: ${streamId}, broadcasted to room`,
      );
    } catch (error) {
      console.error('🚨 [SFU-WS] Produce error:', error);
      client.emit('sfu:error', {
        message: 'Failed to produce',
        code: 'PRODUCE_ERROR',
      });
    }
  }

  @SubscribeMessage('sfu:consume')
  async handleConsume(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { streamId: string; transportId: string },
  ) {
    console.log(`🍽️ [SFU-WS] Consume request: ${data.streamId}`);

    const participant = this.getParticipantBySocketId(client.id);
    if (!participant) {
      client.emit('sfu:error', {
        message: 'Participant not found',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    const transport = participant.transports.get(data.transportId);
    if (!transport) {
      client.emit('sfu:error', {
        message: 'Transport not found',
        code: 'TRANSPORT_NOT_FOUND',
      });
      return;
    }

    const roomId = this.getParticipantRoom(participant);
    if (!roomId) {
      client.emit('sfu:error', {
        message: 'Room not found',
        code: 'ROOM_NOT_FOUND',
      });
      return;
    }

    // Find stream
    const stream = this.streams.get(data.streamId);
    if (!stream) {
      console.log(`🚨 [SFU-WS] Stream not found: ${data.streamId}`);
      client.emit('sfu:error', {
        message: 'Stream not found',
        code: 'STREAM_NOT_FOUND',
      });
      return;
    }

    // Check RTP capabilities
    if (!participant.rtpCapabilities) {
      client.emit('sfu:error', {
        message: 'RTP capabilities not set',
        code: 'RTP_CAPABILITIES_NOT_SET',
      });
      return;
    }

    // Check if can consume
    const router = await this.sfuService.getMediaRouter(roomId);
    const canConsume = router.canConsume({
      producerId: stream.producerId,
      rtpCapabilities: participant.rtpCapabilities,
    });

    if (!canConsume) {
      console.log(`🚨 [SFU-WS] Cannot consume stream ${data.streamId}`);
      console.log(`🚨 [SFU-WS] Producer ID: ${stream.producerId}`);
      console.log(
        `🚨 [SFU-WS] Participant RTP Capabilities:`,
        JSON.stringify(participant.rtpCapabilities, null, 2),
      );

      client.emit('sfu:error', {
        message: 'Cannot consume this stream',
        code: 'CANNOT_CONSUME',
      });
      return;
    }

    try {
      console.log(`🍽️ [SFU-WS] Creating consumer for ${data.streamId}`);

      const consumer = await transport.consume({
        producerId: stream.producerId,
        rtpCapabilities: participant.rtpCapabilities,
        paused: true,
      });

      // Store consumer
      participant.consumers.set(consumer.id, consumer);

      // Handle consumer close
      consumer.on('producerclose', () => {
        console.log(
          `🍽️ [SFU-WS] Consumer ${consumer.id} closed - producer closed`,
        );
        participant.consumers.delete(consumer.id);
        client.emit('sfu:consumer-closed', {
          consumerId: consumer.id,
          streamId: stream.streamId,
        });
      });

      // Send consumer info to client
      client.emit('sfu:consumer-created', {
        consumerId: consumer.id,
        streamId: stream.streamId,
        producerId: stream.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        metadata: stream.metadata,
      });

      console.log(
        `✅ [SFU-WS] Consumer created: ${consumer.id} for stream: ${data.streamId}`,
      );
    } catch (error) {
      console.error('🚨 [SFU-WS] Consumer creation error:', error);
      client.emit('sfu:error', {
        message: 'Error creating consumer',
        code: 'CONSUMER_ERROR',
      });
    }
  }

  @SubscribeMessage('sfu:resume-consumer')
  async handleResumeConsumer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { consumerId: string },
  ) {
    const participant = this.getParticipantBySocketId(client.id);
    if (!participant) {
      client.emit('sfu:error', {
        message: 'Participant not found',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    const consumer = participant.consumers.get(data.consumerId);
    if (!consumer) {
      client.emit('sfu:error', {
        message: 'Consumer not found',
        code: 'CONSUMER_NOT_FOUND',
      });
      return;
    }

    try {
      console.log(`▶️ [SFU-WS] Resuming consumer: ${data.consumerId}`);
      await consumer.resume();
      client.emit('sfu:consumer-resumed', { consumerId: data.consumerId });
      console.log(`✅ [SFU-WS] Consumer resumed: ${data.consumerId}`);
    } catch (error) {
      console.error('🚨 [SFU-WS] Resume consumer error:', error);
      client.emit('sfu:error', {
        message: 'Failed to resume consumer',
        code: 'RESUME_CONSUMER_ERROR',
      });
    }
  }

  @SubscribeMessage('sfu:presence')
  async handlePresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; peerId: string; metadata?: any },
  ) {
    console.log(
      `👋 [SFU-WS] Presence notification from ${data.peerId} in room ${data.roomId}`,
    );

    const participant = this.getParticipantBySocketId(client.id);
    if (!participant) {
      console.log(
        `❌ [SFU-WS] Participant not found for presence from ${data.peerId}`,
      );
      return;
    }

    const roomId = data.roomId;

    // Broadcast presence to other clients in the room
    client.to(roomId).emit('sfu:presence', {
      peerId: data.peerId,
      metadata: data.metadata,
      timestamp: Date.now(),
    });

    console.log(
      `✅ [SFU-WS] Presence broadcasted for ${data.peerId} to room ${roomId}`,
    );
  }

  // Helper methods
  private getParticipantBySocketId(socketId: string): Participant | null {
    console.log(
      `🔍 [SFU-WS] Looking for participant with socketId: ${socketId}`,
    );
    console.log(
      `🔍 [SFU-WS] Available rooms: ${Array.from(this.rooms.keys())}`,
    );

    for (const [roomId, room] of this.rooms.entries()) {
      console.log(
        `🔍 [SFU-WS] Checking room ${roomId} with ${room.size} participants`,
      );
      for (const [peerId, participant] of room.entries()) {
        console.log(
          `🔍 [SFU-WS] Participant ${peerId} has socketId: ${participant.socketId}`,
        );
        if (participant.socketId === socketId) {
          console.log(
            `✅ [SFU-WS] Found participant: ${peerId} with socketId: ${socketId}`,
          );
          return participant;
        }
      }
    }
    console.log(`❌ [SFU-WS] No participant found with socketId: ${socketId}`);
    return null;
  }

  private getParticipantRoom(participant: Participant): string | null {
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.has(participant.peerId)) {
        return roomId;
      }
    }
    return null;
  }
}
