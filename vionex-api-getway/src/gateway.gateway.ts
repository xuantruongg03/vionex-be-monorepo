import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomClientService } from './clients/room.client';
import { SfuClientService } from './clients/sfu.client';
import { Participant } from './interfaces/interface';
import { HttpBroadcastService } from './services/http-broadcast.service';
import { WebSocketEventService } from './services/websocket-event.service';

@WebSocketGateway({
  transports: ['websocket'],
  cors: { origin: '*', credentials: true },
  path: '/socket.io',
  serveClient: false,
})
export class GatewayGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() io: Server;
  private connectionMap = new Map<string, string>(); // socketId -> peerId
  private participantSocketMap = new Map<string, string>(); // peerId -> socketId
  private roomParticipantMap = new Map<string, string>(); // peerId -> roomId

  constructor(
    private readonly eventService: WebSocketEventService,
    private readonly roomClient: RoomClientService,
    private readonly httpBroadcastService: HttpBroadcastService,
    private readonly sfuClient: SfuClientService,
  ) {}
  handleConnection(client: Socket) {
    this.httpBroadcastService.setSocketServer(this.io);
  }

  async handleDisconnect(client: Socket) {
    // Get participant info before cleanup
    let peerId = this.connectionMap.get(client.id);
    let roomId = peerId ? this.roomParticipantMap.get(peerId) : null;

    if (!peerId || !roomId) {
      try {
        // Query Room service to find any participant with this socket_id
        const participantInfo = await this.roomClient.findParticipantBySocketId(
          client.id,
        );
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
          // Try a more targeted approach first - look for pending-ws patterns
          const pendingPeerId = client.id.startsWith('pending-ws-')
            ? client.id.replace('pending-ws-', '')
            : null;

          if (pendingPeerId) {
            // Direct lookup for pending WebSocket connections
            const targetRoomId = this.roomParticipantMap.get(pendingPeerId);
            if (targetRoomId) {
              peerId = pendingPeerId;
              roomId = targetRoomId;
            }
          }

          // If still not found, do full scan
          if (!peerId || !roomId) {
            const allRooms = await this.getAllRoomsWithParticipants();

            for (const [currentRoomId, participants] of allRooms) {
              const participant = participants.find(
                (p) =>
                  p.socket_id === client.id ||
                  p.socket_id === `pending-ws-${client.id}` ||
                  (p.socket_id && p.socket_id.includes(client.id)),
              );

              if (participant) {
                peerId = participant.peer_id || participant.peerId;
                roomId = currentRoomId;
                break;
              }
            }
          }
        } catch (scanError) {
          console.error(`[Gateway] Error scanning for participant:`, scanError);
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
              console.log(
                `[Gateway] Broadcasting stream-removed for stream ${streamId}`,
              );
              this.io.to(roomId).emit('sfu:stream-removed', {
                streamId: streamId,
                publisherId: peerId,
              });
            }
          }
        } catch (error) {
          console.error('[BACKEND] Error removing participant media:', error);
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
        const participant = await this.roomClient.getParticipantByPeerId(
          roomId,
          peerId,
        );
        if (participant?.is_creator && leaveRoomResponse?.data?.newCreator) {
          this.io.to(roomId).emit('sfu:creator-changed', {
            peerId: leaveRoomResponse.data.newCreator,
            isCreator: true,
          });
        }

        // Broadcast updated users list to all remaining clients in room
        // Add delay to ensure Room service has time to update after leave request
        setTimeout(async () => {
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

              // Verify the left user is not in the list
              const leftUserStillPresent = users.find(
                (u) => u.peerId === peerId,
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
        }, 2000); // Increase delay to 2 seconds
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
    @MessageBody() data: { roomId: string; peerId: string; password?: string },
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
      // Lấy lại room data sau khi tạo
      room = await this.roomClient.getRoom(data.roomId);
    }

    const isCreator =
      !room.data?.participants || room.data.participants.length === 0;

    // Double-check username is not already in use (safety measure)
    if (
      room &&
      room.data?.participants?.some(
        (p) =>
          p.peerId === data.peerId || (p.peer_id && p.peer_id === data.peerId),
      )
    ) {
      this.eventService.emitError(
        client,
        'Username already in use',
        'USERNAME_TAKEN',
      );
      return;
    }

    // Check if participant already exists (from HTTP join)
    let existingParticipant: Participant | null = null;
    try {
      existingParticipant = await this.roomClient.getParticipantByPeerId(
        data.roomId,
        data.peerId,
      );
    } catch (error) {
      console.log(`[Gateway] getParticipantByPeerId threw error:`, error);
    }

    if (existingParticipant) {
      // Update existing participant's socket_id to the WebSocket connection
      existingParticipant.socket_id = client.id;

      try {
        await this.roomClient.setParticipant(data.roomId, existingParticipant);

        // Store the mapping for gateway routing - IMPORTANT for disconnect handling
        this.storeParticipantMapping(client.id, data.peerId, data.roomId);

        // Emit join success with existing participant data
        this.eventService.emitToClient(client, 'sfu:join-success', {
          peerId: existingParticipant.peer_id,
          isCreator: existingParticipant.is_creator,
          roomId: data.roomId,
        });

        // Don't broadcast new-peer-join since this user already joined via HTTP
        // Just get updated users list and broadcast it
        try {
          const updatedRoom = await this.roomClient.getRoom(data.roomId);
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

            this.eventService.broadcastToRoom(
              client,
              data.roomId,
              'sfu:users-updated',
              {
                users,
                roomId: data.roomId,
              },
            );
          }
        } catch (error) {
          console.error('Failed to broadcast updated users list:', error);
        }

        return; // Exit early since we updated existing participant
      } catch (error) {
        console.error(`Failed to update existing participant:`, error);
        this.eventService.emitError(
          client,
          'Failed to update participant',
          'UPDATE_PARTICIPANT_ERROR',
        );
        return;
      }
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
      this.storeParticipantMapping(client.id, data.peerId, data.roomId);

      // Emit join success immediately after participant is added
      this.eventService.emitToClient(client, 'sfu:join-success', {
        peerId: participant.peer_id,
        isCreator: participant.is_creator,
        roomId: data.roomId,
      });

      // Immediately broadcast to existing clients that a new peer joined
      // This ensures all existing clients are notified before the new client gets streams
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

      // Get updated users list and send to all clients (including new client)
      try {
        const updatedRoom = await this.roomClient.getRoom(data.roomId);
        if (updatedRoom && updatedRoom.data && updatedRoom.data.participants) {
          const users = updatedRoom.data.participants.map(
            (participant: any) => ({
              peerId: participant.peer_id,
              isCreator: participant.is_creator,
              timeArrive: participant.time_arrive,
            }),
          );

          // Send to all clients in room (including new client)
          this.io.to(data.roomId).emit('sfu:users-updated', { users });

          // Also send directly to new client to ensure they get it
          this.eventService.emitToClient(client, 'sfu:users-updated', {
            users,
          });
        }
      } catch (error) {
        console.error('Error broadcasting updated users list on join:', error);
      }
    } catch (error) {
      console.error('Error setting participant:', error);
      this.eventService.emitError(client, 'Failed to join room', 'JOIN_ERROR');
      return;
    }
    // Gửi router RTP capabilities đến client
    try {
      const router = await this.sfuClient.createMediaRoom(data.roomId);
      this.eventService.emitToClient(client, 'sfu:router-capabilities', {
        routerRtpCapabilities: router,
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

    // Emit empty streams initially - streams will be populated as users join
    this.eventService.emitToClient(client, 'sfu:streams', []);
  }

  @SubscribeMessage('sfu:set-rtp-capabilities')
  async handleSetRtpCapabilities(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { rtpCapabilities: any; roomId?: string; peerId?: string },
  ) {
    try {
      // Extract peerId from socket mapping
      const peerId = data.peerId || this.getParticipantBySocketId(client.id);
      const roomId = data.roomId || (await this.getRoomIdBySocketId(client.id));

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
      const peerId = data.peerId || this.getParticipantBySocketId(client.id);

      const transportInfo = await this.sfuClient.createTransport(
        data.roomId,
        peerId,
        data.isProducer,
      );

      // Parse the transport_data from SFU gRPC response
      let actualTransportData;
      if ((transportInfo as any).transport_data) {
        try {
          const parsedData = JSON.parse((transportInfo as any).transport_data);
          actualTransportData = parsedData.transport || parsedData;
        } catch (error) {
          console.error('[Gateway] Failed to parse transport_data:', error);
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
      const peerId = data.peerId || this.getParticipantBySocketId(client.id);
      const roomId = data.roomId || (await this.getRoomIdBySocketId(client.id));

      await this.sfuClient.connectTransport(
        data.transportId,
        data.dtlsParameters,
        roomId,
        peerId,
      );

      client.emit('sfu:transport-connected', { transportId: data.transportId });
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
      const peerId = data.peerId || this.getParticipantBySocketId(client.id);
      const roomId = data.roomId || (await this.getRoomIdBySocketId(client.id));

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

      console.log('[Gateway] SFU produce result:', result);

      client.emit('sfu:producer-created', {
        producerId: (result as any).producerId || (result as any).producer_id,
        streamId: (result as any).streamId || (result as any).stream_id,
        kind: data.kind,
        appData: data.metadata,
      });

      // Broadcast new stream to other participants
      client.to(roomId).emit('sfu:stream-added', {
        streamId: (result as any).streamId || (result as any).stream_id,
        publisherId: peerId,
        metadata: data.metadata,
        rtpParameters: data.rtpParameters,
      });

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
      const peerId = data.peerId || this.getParticipantBySocketId(client.id);
      const roomId = data.roomId || (await this.getRoomIdBySocketId(client.id));

      const consumerInfo = await this.sfuClient.consume(
        data.streamId,
        data.transportId,
        roomId,
        peerId,
      );

      client.emit('sfu:consumer-created', {
        consumerId:
          (consumerInfo as any).consumerId || (consumerInfo as any).consumer_id,
        producerId:
          (consumerInfo as any).producerId || (consumerInfo as any).producer_id,
        kind: (consumerInfo as any).kind,
        rtpParameters:
          (consumerInfo as any).rtpParameters ||
          (consumerInfo as any).rtp_parameters,
        streamId: data.streamId,
      });

      return { success: true };
    } catch (error) {
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
      const roomId = data.roomId || (await this.getRoomIdBySocketId(client.id));

      await this.sfuClient.resumeConsumer(data.consumerId, roomId, peerId);

      client.emit('sfu:consumer-resumed', { consumerId: data.consumerId });
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

      client.emit('sfu:streams', (streams as any).streams || streams || []);
      return { success: true };
    } catch (error) {
      client.emit('sfu:error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('sfu:presence')
  async handlePresence(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; peerId: string; metadata: any },
  ) {
    try {
      await this.sfuClient.sendPresence(
        data.roomId,
        data.peerId,
        data.metadata,
      );

      // Broadcast presence to other participants in room
      client.to(data.roomId).emit('sfu:presence', {
        peerId: data.peerId,
        metadata: data.metadata,
      });

      return { success: true };
    } catch (error) {
      client.emit('sfu:error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  // Helper methods
  private getParticipantBySocketId(socketId: string): string {
    return this.connectionMap.get(socketId) || '';
  }

  private async getRoomIdBySocketId(socketId: string): Promise<string> {
    const peerId = this.connectionMap.get(socketId);
    if (peerId) {
      return this.roomParticipantMap.get(peerId) || '';
    }
    return '';
  }

  // Helper method to get all rooms with participants for disconnect handling
  private async getAllRoomsWithParticipants(): Promise<Map<string, any[]>> {
    const roomsMap = new Map<string, any[]>();

    // Since we don't have a direct way to get all rooms, we'll use the room participant map
    // to identify rooms, then get their details
    const knownRoomIds = new Set<string>();

    // Collect room IDs from the participant map
    for (const roomId of this.roomParticipantMap.values()) {
      knownRoomIds.add(roomId);
    }

    // Also check rooms that clients are joined to
    for (const [socketId, rooms] of this.io.sockets.adapter.rooms) {
      // Skip individual socket rooms (they have same ID as socket)
      if (!this.io.sockets.sockets.has(socketId)) {
        knownRoomIds.add(socketId);
      }
    }

    // Get participants for each known room
    for (const roomId of knownRoomIds) {
      try {
        const room = await this.roomClient.getRoom(roomId);
        if (room.data?.participants) {
          roomsMap.set(roomId, room.data.participants);
        }
      } catch (error) {
        console.error(`[Gateway] Error getting room ${roomId}:`, error);
      }
    }

    return roomsMap;
  }

  // Store mapping when participant joins
  private storeParticipantMapping(
    socketId: string,
    peerId: string,
    roomId: string,
  ) {
    this.connectionMap.set(socketId, peerId);
    this.participantSocketMap.set(peerId, socketId);
    this.roomParticipantMap.set(peerId, roomId);
  }

  // Clean up mapping when participant leaves
  private cleanupParticipantMapping(socketId: string) {
    const peerId = this.connectionMap.get(socketId);
    if (peerId) {
      this.connectionMap.delete(socketId);
      this.participantSocketMap.delete(peerId);
      this.roomParticipantMap.delete(peerId);
    }
  }

  // Helper function to find participant by socket ID using connection mapping
  private async findParticipantBySocketId(
    socketId: string,
  ): Promise<{ participant: Participant | null; roomId: string | null }> {
    if (this.connectionMap.has(socketId)) {
      const peerId = this.connectionMap.get(socketId);

      if (peerId) {
        // Find participant by peerId across all rooms
        const roomId = await this.roomClient.getParticipantRoom(peerId);

        if (roomId) {
          const participant = await this.roomClient.getParticipantByPeerId(
            roomId,
            peerId,
          );
          if (participant) {
            return { participant, roomId };
          }
        }
      }
    }

    return { participant: null, roomId: null };
  }
}
