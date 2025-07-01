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
import { ChatClientService } from './clients/chat.client';
import { RoomClientService } from './clients/room.client';
import { SfuClientService } from './clients/sfu.client';
import { Participant } from './interfaces/interface';
import { HttpBroadcastService } from './services/http-broadcast.service';
import { WebSocketEventService } from './services/websocket-event.service';
import { InteractionClientService } from './clients/interaction.client';
import { ClearWhiteboardResponse, GetPermissionsResponse, GetWhiteboardDataResponse, UpdatePermissionsResponse, UpdateUserPointerResponse } from './interfaces/whiteboard';



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
    private readonly chatClient: ChatClientService,
    private readonly interactionClient: InteractionClientService,
  ) {}
  handleConnection(client: Socket) {
    console.log('[Gateway] New client connected:', client.id);
    this.httpBroadcastService.setSocketServer(this.io);

    // Debug: Log all incoming events
    client.onAny((eventName, ...args) => {
      console.log(
        `[Gateway] Received event '${eventName}' from client ${client.id}:`,
        args,
      );
    });
  }

  async handleDisconnect(client: Socket) {
    // Get participant info before cleanup
    let peerId = this.connectionMap.get(client.id);
    let roomId = peerId ? this.roomParticipantMap.get(peerId) : null;

    if (!peerId || !roomId) {
      try {
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
          // If still not found, do full scan
          if (!peerId || !roomId) {
            const allRooms = await this.getAllRoomsWithParticipants();

            for (const [currentRoomId, participants] of allRooms) {
              const participant = participants.find(
                (p) =>
                  p.socket_id === client.id ||
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
    } else {
      console.log(
        `[Gateway] No participant found for disconnect - socketId: ${client.id}`,
      );
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
      room = await this.roomClient.getRoom(data.roomId);
    }

    let hasExistingCreator = false;
    let isRoomEmpty = false;

    if (room.data?.participants && room.data.participants.length > 0) {
      const otherParticipants = room.data.participants.filter((p) => {
        const participantId = p.peerId || p.peer_id;
        return participantId !== data.peerId;
      });
      hasExistingCreator = otherParticipants.some((p) => p.is_creator === true);

      // Room trống nếu không có participant nào khác
      isRoomEmpty = otherParticipants.length === 0;
    } else {
      // Room không có participants nào
      isRoomEmpty = true;
    }

    const isCreator = !hasExistingCreator && isRoomEmpty;

    // Check if this is a legitimate participant trying to connect via WebSocket
    // (participant exists from HTTP join but needs socket_id update)
    let isExistingParticipantWithPendingSocket = false;

    if (
      room &&
      room.data?.participants?.some((p) => {
        const participantId = p.peerId || p.peer_id;
        const socketId = p.socket_id || p.socketId || '';
        const matches = participantId === data.peerId;
        const hasPendingSocket = socketId.startsWith('pending-ws-');

        return matches && hasPendingSocket;
      })
    ) {
      isExistingParticipantWithPendingSocket = true;
    } else if (
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

        // Send router capabilities to client for WebRTC setup
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

        // Send existing streams to the existing client connecting via WebSocket
        try {
          const existingStreamsResponse = await this.sfuClient.getStreams(
            data.roomId,
          );

          // Extract streams array from response - handle both possible structures
          const existingStreams =
            (existingStreamsResponse as any)?.streams || [];

          if (
            existingStreams &&
            Array.isArray(existingStreams) &&
            existingStreams.length > 0
          ) {
            // Filter streams from other users (not from the current client)
            const otherUserStreams = existingStreams.filter((stream) => {
              const isFromOtherUser =
                stream.publisher_id && stream.publisher_id !== data.peerId;
              const hasValidStreamId =
                stream.stream_id && stream.stream_id !== 'undefined';

              return isFromOtherUser && hasValidStreamId;
            });

            if (otherUserStreams.length > 0) {
              // Send bulk streams to existing client
              this.eventService.emitToClient(
                client,
                'sfu:streams',
                otherUserStreams,
              );

              // Also send individual stream-added events for each stream
              for (const stream of otherUserStreams) {
                if (stream.stream_id && stream.publisher_id) {
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
                      `[Gateway] Failed to parse metadata for existing client stream ${stream.stream_id}:`,
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
                    if (stream.rtp_parameters) {
                      if (typeof stream.rtp_parameters === 'string') {
                        parsedRtpParameters = JSON.parse(stream.rtp_parameters);
                      } else {
                        parsedRtpParameters = stream.rtp_parameters;
                      }
                    }
                  } catch (rtpError) {
                    console.error(
                      `[Gateway] Failed to parse rtp_parameters for existing client stream ${stream.stream_id}:`,
                      rtpError,
                    );
                    parsedRtpParameters = {};
                  }
                  this.eventService.emitToClient(client, 'sfu:stream-added', {
                    streamId: stream.stream_id,
                    publisherId: stream.publisher_id,
                    metadata: parsedMetadata,
                    rtpParameters: parsedRtpParameters,
                  });
                }
              }
            } else {
              // Send empty streams array
              this.eventService.emitToClient(client, 'sfu:streams', []);
            }
          } else {
            console.log(
              `[Gateway] No existing streams found for existing client in room ${data.roomId}`,
            );
            // Send empty streams array
            this.eventService.emitToClient(client, 'sfu:streams', []);
          }
        } catch (error) {
          console.error(
            'Failed to get existing streams for existing client:',
            error,
          );
          // Don't fail the join process, just log the error
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

      // Initialize whiteboard permissions if this is the creator
      if (participant.is_creator) {
        try {
          await this.interactionClient.initializeRoomPermissions(
            data.roomId,
            data.peerId,
          );
        } catch (error) {
          console.error('Failed to initialize whiteboard permissions:', error);
          // Don't fail the join process for whiteboard initialization failure
        }
      }

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
    try {
      const routerCapabilities = await this.sfuClient.getRouterRtpCapabilities(
        data.roomId,
      );

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

      // Extract streams array from response - handle both possible structures
      const existingStreams = (existingStreamsResponse as any)?.streams || [];

      if (
        existingStreams &&
        Array.isArray(existingStreams) &&
        existingStreams.length > 0
      ) {
        // Filter streams from other users (not from the new joining user)
        const otherUserStreams = existingStreams.filter((stream) => {
          const isFromOtherUser =
            stream.publisher_id && stream.publisher_id !== data.peerId;
          const hasValidStreamId =
            stream.stream_id && stream.stream_id !== 'undefined';

          return isFromOtherUser && hasValidStreamId;
        });

        if (otherUserStreams.length > 0) {
          // Send bulk streams to new client
          this.eventService.emitToClient(
            client,
            'sfu:streams',
            otherUserStreams,
          );

          // Also send individual stream-added events for each stream
          for (const stream of otherUserStreams) {
            if (stream.stream_id && stream.publisher_id) {
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
                  `[Gateway] Failed to parse metadata for stream ${stream.stream_id}:`,
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
                if (stream.rtp_parameters) {
                  if (typeof stream.rtp_parameters === 'string') {
                    parsedRtpParameters = JSON.parse(stream.rtp_parameters);
                  } else {
                    parsedRtpParameters = stream.rtp_parameters;
                  }
                }
              } catch (rtpError) {
                console.error(
                  `[Gateway] Failed to parse rtp_parameters for stream ${stream.stream_id}:`,
                  rtpError,
                );
                parsedRtpParameters = {};
              }
              this.eventService.emitToClient(client, 'sfu:stream-added', {
                streamId: stream.stream_id,
                publisherId: stream.publisher_id,
                metadata: parsedMetadata,
                rtpParameters: parsedRtpParameters,
              });
            }
          }
        } else {
          console.log(
            `[Gateway] No consumable streams from other users found (all streams are from ${data.peerId})`,
          );
          // Send empty streams array
          this.eventService.emitToClient(client, 'sfu:streams', []);
        }
      } else {
        console.log(
          `[Gateway] No existing streams found for room ${data.roomId}`,
        );
        // Send empty streams array
        this.eventService.emitToClient(client, 'sfu:streams', []);
      }
    } catch (error) {
      console.error('Failed to get existing streams for new client:', error);
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

      // Parse producer_data if it's a string
      let producerData: any = result;
      if (typeof (result as any).producer_data === 'string') {
        try {
          producerData = JSON.parse((result as any).producer_data);
        } catch (e) {
          console.error('[Gateway] Failed to parse producer_data:', e);
        }
      }

      const producerId = producerData.producer_id || producerData.producerId;
      const streamId = producerData.streamId || producerData.stream_id;

      client.emit('sfu:producer-created', {
        producerId: producerId,
        streamId: streamId,
        kind: data.kind,
        appData: safeMetadata,
      });

      client.to(roomId).emit('sfu:stream-added', {
        streamId: streamId,
        publisherId: peerId,
        metadata: safeMetadata,
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

      const peerId = data.peerId || this.getParticipantBySocketId(client.id);
      const roomId = data.roomId || (await this.getRoomIdBySocketId(client.id));

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
          consumerData = JSON.parse((consumerInfo as any).consumer_data);
        } else {
          console.error(
            '[Gateway] No consumer_data in response:',
            consumerInfo,
          );
          throw new Error('Invalid consumer response format');
        }
      } catch (parseError) {
        console.error('[Gateway] Failed to parse consumer data:', parseError);
        throw new Error('Failed to parse consumer response');
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
              parsedRtpParameters = JSON.parse(stream.rtpParameters);
            } else {
              parsedRtpParameters = stream.rtpParameters;
            }
          } else if (stream.rtp_parameters) {
            if (typeof stream.rtp_parameters === 'string') {
              parsedRtpParameters = JSON.parse(stream.rtp_parameters);
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

  // ======================================================CHAT======================================================
  @SubscribeMessage('chat:join')
  async handleChatJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; userName: string },
  ) {
    const roomId = data.roomId;

    try {
      // Get chat history from chat service
      const messages = await this.chatClient.getMessages({ room_id: roomId });

      // Send history to client
      if (messages.success) {
        client.emit('chat:history', messages.messages);
      } else {
        client.emit('chat:history', []);
      }
    } catch (error) {
      console.error('Error getting chat history:', error);
      client.emit('chat:history', []);
    }
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
      };
    },
  ) {
    const roomId = data.roomId;
    console.log('data: ', data);

    try {
      // Send message to chat service
      const result = await this.chatClient.sendMessage({
        room_id: roomId,
        sender: data.message.sender,
        sender_name: data.message.senderName,
        text: data.message.text,
      });

      if (result.success && result.message) {
        // Broadcast message to all clients in the room
        this.io.to(roomId).emit('chat:message', result.message);
      } else {
        // Send error to client if message couldn't be saved
        client.emit('chat:error', {
          message: 'Failed to save message',
          code: 'SAVE_ERROR',
        });
      }
    } catch (error) {
      console.error('Error handling chat message:', error);
      client.emit('chat:error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
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
        fileUrl?: string;
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        isImage?: boolean;
      };
    },
  ) {
    const roomId = data.roomId;

    try {
      // Send file message to chat service
      const result = await this.chatClient.sendMessage({
        room_id: roomId,
        sender: data.message.sender,
        sender_name: data.message.senderName,
        text: data.message.text,
        fileUrl: data.message.fileUrl,
        fileName: data.message.fileName,
        fileType: data.message.fileType,
        fileSize: data.message.fileSize,
        isImage: data.message.isImage,
      });

      if (result.success && result.message) {
        // Broadcast file message to all clients in the room
        this.io.to(roomId).emit('chat:message', result.message);
      } else {
        // Send error to client if file message couldn't be saved
        client.emit('chat:error', {
          message: 'Failed to send file',
          code: 'FILE_ERROR',
        });
      }
    } catch (error) {
      console.error('Error handling chat file:', error);
      client.emit('chat:error', {
        message: 'Failed to send file',
        code: 'FILE_ERROR',
      });
    }
  }

  @SubscribeMessage('chat:leave')
  handleChatLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    // No special handling needed, just acknowledge
    console.log(`User left chat room: ${data.roomId}`);
  }

  // ======================================================WHITEBOARD======================================================
  @SubscribeMessage('whiteboard:update')
  async handleWhiteboardUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; elements: any; state: any },
  ) {
    const roomId = data.roomId;
    const peerId = this.getParticipantBySocketId(client.id);

    if (!peerId) {
      console.log('[Gateway] User not found for socket:', client.id);
      client.emit('whiteboard:error', {
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
      return;
    }

    try {
      // Check if user has permission to draw
      const permissionResult = await this.interactionClient.checkUserPermission(
        roomId,
        peerId,
      );
      if (!permissionResult.success || !permissionResult.can_draw) {
        client.emit('whiteboard:error', {
          message: 'No permission to edit whiteboard',
          code: 'NO_PERMISSION',
        });
        return;
      }
      // Update whiteboard data via interaction service
      const result = (await this.interactionClient.updateWhiteboard(
        roomId,
        data.elements,
        JSON.stringify(data.state || {}),
      )) as { success: boolean; whiteboard_data?: any };

      console.log('🎨 [Gateway] Update whiteboard result:', result);

      if (result.success) {
        // Broadcast update to all clients in the room
        this.io.to(roomId).emit('whiteboard:update', {
          elements: data.elements,
          state: data.state,
        });
      } else {
        console.log('[Gateway] Update failed');
        client.emit('whiteboard:error', {
          message: 'Failed to update whiteboard',
          code: 'UPDATE_ERROR',
        });
      }
    } catch (error) {
      console.error('Error handling whiteboard update:', error);
      client.emit('whiteboard:error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  @SubscribeMessage('whiteboard:get-data')
  async handleGetWhiteboardData(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    try {
      const result = (await this.interactionClient.getWhiteboardData(
        data.roomId,
      )) as GetWhiteboardDataResponse;

      if (result.success) {
        const dataToEmit = {
          elements: result.whiteboard_data?.elements || [],
          state: result.whiteboard_data?.state
            ? JSON.parse(result.whiteboard_data.state)
            : {},
        };

        client.emit('whiteboard:data', dataToEmit);
      } else {
        console.log('[Gateway] No whiteboard data found, emitting empty data');
        client.emit('whiteboard:data', {
          elements: [],
          state: {},
        });
      }
    } catch (error) {
      console.error('[Gateway] Error getting whiteboard data:', error);
      client.emit('whiteboard:data', {
        elements: [],
        state: {},
      });
    }
  }

  @SubscribeMessage('whiteboard:clear')
  async handleClearWhiteboard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    try {
      const result = (await this.interactionClient.clearWhiteboard(
        data.roomId,
      )) as ClearWhiteboardResponse;

      if (result.success) {
        // Broadcast clear to all clients in the room
        this.io.to(data.roomId).emit('whiteboard:cleared');
      }
    } catch (error) {
      console.error('Error clearing whiteboard:', error);
    }
  }

  @SubscribeMessage('whiteboard:update-permissions')
  async handleWhiteboardPermissions(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; allowed: string[] },
  ) {
    try {
      const result = (await this.interactionClient.updatePermissions(
        data.roomId,
        data.allowed,
      )) as UpdatePermissionsResponse;
      if (result.success) {
        // Broadcast permission update to all clients in the room
        this.io.to(data.roomId).emit('whiteboard:permissions-updated', {
          allowed: result.allowed_users,
        });
      }
    } catch (error) {
      console.error('Error updating whiteboard permissions:', error);
    }
  }

  @SubscribeMessage('whiteboard:get-permissions')
  async handleGetWhiteboardPermissions(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    try {
      const result = (await this.interactionClient.getPermissions(
        data.roomId,
      )) as GetPermissionsResponse;

      client.emit('whiteboard:permissions', {
        allowed: result.allowed_users || [],
      });
    } catch (error) {
      console.error('Error getting whiteboard permissions:', error);
      client.emit('whiteboard:permissions', {
        allowed: [],
      });
    }
  }

  @SubscribeMessage('whiteboard:pointer')
  async handleWhiteboardPointer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; position: { x: number; y: number; tool: string } },
  ) {
    const peerId = this.getParticipantBySocketId(client.id);
    if (!peerId) return;

    try {
      const result = (await this.interactionClient.updateUserPointer(
        data.roomId,
        peerId,
        data.position,
      )) as UpdateUserPointerResponse;

      if (result.success) {
        // Broadcast pointer position to other clients in the room
        client.to(data.roomId).emit('whiteboard:pointer-update', {
          peerId,
          position: data.position,
        });
      }
    } catch (error) {
      console.error('Error updating whiteboard pointer:', error);
    }
  }

  @SubscribeMessage('whiteboard:pointer-leave')
  async handleWhiteboardPointerLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const peerId = this.getParticipantBySocketId(client.id);
    if (!peerId) return;

    try {
      await this.interactionClient.removeUserPointer(data.roomId, peerId);

      // Broadcast pointer removal to other clients in the room
      client.to(data.roomId).emit('whiteboard:pointer-remove', {
        peerId,
      });
    } catch (error) {
      console.error('Error removing whiteboard pointer:', error);
    }
  }

  // ======================================================VOTING======================================================
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
    try {
      const result = await this.interactionClient.createVote(
        data.roomId,
        data.question,
        data.options,
        data.creatorId,
      );
      if ((result as any).success) {
        // Broadcast new vote to all clients in the room
        this.io
          .to(data.roomId)
          .emit('sfu:vote-created', (result as any).vote_session);
      } else {
        console.error('[Gateway] Create vote failed:', (result as any).error);
        client.emit('sfu:vote-error', {
          message: (result as any).error || 'Failed to create vote',
          code: 'CREATE_ERROR',
        });
      }
    } catch (error) {
      console.error('[Gateway] Error creating vote:', error);
      client.emit('sfu:vote-error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
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
    try {
      const result = await this.interactionClient.submitVote(
        data.roomId,
        data.voteId,
        data.optionId,
        data.voterId,
      );

      if ((result as any).success) {
        // Broadcast updated vote results to all clients in the room
        this.io
          .to(data.roomId)
          .emit('sfu:vote-updated', (result as any).vote_session);
      } else {
        console.error('[Gateway] Submit vote failed:', (result as any).error);
        client.emit('sfu:vote-error', {
          message: (result as any).error || 'Failed to submit vote',
          code: 'SUBMIT_ERROR',
        });
      }
    } catch (error) {
      console.error('[Gateway] Error submitting vote:', error);
      client.emit('sfu:vote-error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
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
    try {
      const result = await this.interactionClient.getVoteResults(
        data.roomId,
        data.voteId,
      );

      if ((result as any).success) {
        client.emit('sfu:vote-results', (result as any).vote_session);
      } else {
        console.error(
          '[Gateway] Get vote results failed:',
          (result as any).error,
        );
        client.emit('sfu:vote-error', {
          message: (result as any).error || 'Vote not found',
          code: 'NOT_FOUND',
        });
      }
    } catch (error) {
      console.error('[Gateway] Error getting vote results:', error);
      client.emit('sfu:vote-error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
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
    try {
      const result = await this.interactionClient.endVote(
        data.roomId,
        data.voteId,
        data.creatorId,
      );

      if ((result as any).success) {
        // Broadcast vote end to all clients in the room
        this.io
          .to(data.roomId)
          .emit('sfu:vote-ended', (result as any).vote_session);
      } else {
        console.error('[Gateway] End vote failed:', (result as any).error);
        client.emit('sfu:vote-error', {
          message: (result as any).error || 'Failed to end vote',
          code: 'END_ERROR',
        });
      }
    } catch (error) {
      console.error('[Gateway] Error ending vote:', error);
      client.emit('sfu:vote-error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  @SubscribeMessage('sfu:get-active-vote')
  async handleGetActiveVote(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomId: string;
    },
  ) {
    try {
      const result = await this.interactionClient.getActiveVote(data.roomId);
      if ((result as any).success && (result as any).vote_session) {
        client.emit('sfu:active-vote', (result as any).vote_session);
      } else {
        client.emit('sfu:active-vote', null);
      }
    } catch (error) {
      console.error('[Gateway] Error getting active vote:', error);
      client.emit('sfu:active-vote', null);
    }
  }

  // ======================================================QUIZ======================================================
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
    try {
      // Type assertion for safety
      const typedData = data as {
        roomId: string;
        title: string;
        questions: any[];
        creatorId: string;
      };

      if (
        !typedData.roomId ||
        !typedData.title ||
        !typedData.questions ||
        !typedData.creatorId
      ) {
        client.emit('quiz:error', {
          message: 'Missing required quiz data',
          code: 'INVALID_DATA',
        });
        return;
      }

      const result = await this.interactionClient.createQuiz(
        typedData.roomId,
        typedData.title,
        typedData.questions,
        typedData.creatorId,
      );

      if ((result as any)?.success) {
        // Broadcast new quiz to all clients in the room
        this.io
          .to(typedData.roomId)
          .emit('quiz:created', (result as any).quiz_session);
      } else {
        console.error(
          '[Gateway] Quiz creation failed:',
          (result as any)?.error,
        );
        client.emit('quiz:error', {
          message: (result as any)?.error || 'Failed to create quiz',
          code: 'CREATE_ERROR',
        });
      }
    } catch (error) {
      console.error('[Gateway] Error creating quiz:', error);
      client.emit('quiz:error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
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
    try {
      // Type assertion for safety
      const typedData = data as {
        roomId: string;
        quizId: string;
        participantId: string;
        answers: Array<{
          questionId: string;
          selectedOptions: string[];
          essayAnswer: string;
        }>;
      };

      if (
        !typedData.roomId ||
        !typedData.quizId ||
        !typedData.participantId ||
        !Array.isArray(typedData.answers)
      ) {
        console.error('[Gateway] Invalid quiz submission data:', data);
        client.emit('quiz:error', {
          message: 'Missing required quiz submission data',
          code: 'INVALID_DATA',
        });
        return;
      }

      const result = await this.interactionClient.submitQuiz(
        typedData.roomId,
        typedData.quizId,
        typedData.participantId,
        typedData.answers,
      );
      if ((result as any)?.success) {
        // Send result to the participant
        client.emit('quiz:result', {
          totalScore: (result as any).total_score,
          totalPossibleScore: (result as any).total_possible_score,
          questionResults: (result as any).question_results,
        });

        // Create detailed results data for the creator
        const detailedResults = {
          quizId: typedData.quizId,
          score: (result as any).total_score,
          totalPossibleScore: (result as any).total_possible_score,
          startedAt: new Date(),
          finishedAt: new Date(),
          questionResults: (result as any).question_results || [], // Use snake_case from gRPC
          submittedAnswers: typedData.answers, // Include the original answers submitted
        };

        // Notify all users in the room that someone submitted
        // Include detailed results for the creator
        client.to(typedData.roomId).emit('quiz:submission', {
          participantId: typedData.participantId,
          totalScore: (result as any).total_score,
          totalPossibleScore: (result as any).total_possible_score, // Add this field
          results: detailedResults, // Add detailed results for creator
        });
      } else {
        console.error(
          '[Gateway] Quiz submission failed:',
          (result as any)?.error,
        );
        client.emit('quiz:error', {
          message: (result as any)?.error || 'Failed to submit quiz',
          code: 'SUBMIT_ERROR',
        });
      }
    } catch (error) {
      console.error('[Gateway] Error submitting quiz:', error);
      client.emit('quiz:error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  @SubscribeMessage('quiz:get-results')
  async handleGetQuizResults(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomId: string;
      quizId: string;
    },
  ) {
    try {
      // Type assertion for safety
      const typedData = data as {
        roomId: string;
        quizId: string;
      };

      if (!typedData.roomId || !typedData.quizId) {
        console.error('[Gateway] Invalid quiz results request data:', data);
        client.emit('quiz:error', {
          message: 'Missing required quiz data',
          code: 'INVALID_DATA',
        });
        return;
      }

      const result = await this.interactionClient.getQuizResults(
        typedData.roomId,
        typedData.quizId,
      );

      if ((result as any)?.success) {
        client.emit('quiz:results', (result as any).quiz_session);
      } else {
        console.error(
          '[Gateway] Quiz results request failed:',
          (result as any)?.error,
        );
        client.emit('quiz:error', {
          message: (result as any)?.error || 'Quiz not found',
          code: 'NOT_FOUND',
        });
      }
    } catch (error) {
      console.error('[Gateway] Error getting quiz results:', error);
      client.emit('quiz:error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
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
    try {
      // Type assertion for safety
      const typedData = data as {
        roomId: string;
        quizId: string;
        creatorId: string;
      };

      if (!typedData.roomId || !typedData.quizId || !typedData.creatorId) {
        console.error('[Gateway] Invalid quiz end data:', data);
        client.emit('quiz:error', {
          message: 'Missing required quiz data',
          code: 'INVALID_DATA',
        });
        return;
      }

      const result = await this.interactionClient.endQuiz(
        typedData.roomId,
        typedData.quizId,
        typedData.creatorId,
      );
      if ((result as any)?.success) {
        // Broadcast quiz end to all clients in the room
        this.io
          .to(typedData.roomId)
          .emit('quiz:ended', (result as any).quiz_session);
      } else {
        console.error('[Gateway] Quiz end failed:', (result as any)?.error);
        client.emit('quiz:error', {
          message: (result as any)?.error || 'Failed to end quiz',
          code: 'END_ERROR',
        });
      }
    } catch (error) {
      console.error('[Gateway] Error ending quiz:', error);
      client.emit('quiz:error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  @SubscribeMessage('quiz:get-active')
  async handleGetActiveQuiz(client: Socket, data: any): Promise<void> {
    try {
      const typedData = data as { roomId: string };

      if (!typedData.roomId) {
        client.emit('quiz:error', {
          message: 'Room ID is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const result = await this.interactionClient.getActiveQuiz(
        typedData.roomId,
      );

      if ((result as any)?.quiz_session) {
        client.emit('quiz:active', result as any);
      } else {
        console.log('[Gateway] No active quiz found for room');
        client.emit('quiz:active', { quiz_session: null });
      }
    } catch (error) {
      console.error('[Gateway] Error getting active quiz:', error);
      client.emit('quiz:error', {
        message: 'Failed to get active quiz',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  // ===================== BEHAVIOR MONITORING METHODS =====================
  @SubscribeMessage('sfu:toggle-behavior-monitor')
  async handleToggleBehaviorMonitor(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; peerId: string; isActive: boolean },
  ) {
    try {
      const roomId = data.roomId;
      const peerId = data.peerId;

      // Check if user is creator
      const isCreator = await this.checkIfUserIsCreator(peerId, roomId);
      if (!isCreator) {
        this.eventService.emitError(
          client,
          'Only room creator can toggle behavior monitoring',
          'NOT_ROOM_CREATOR',
        );
        return;
      }

      // Set behavior monitor state
      await this.interactionClient.setBehaviorMonitorState(
        roomId,
        data.isActive,
      );

      // Broadcast to all clients in the room
      this.io.to(roomId).emit('sfu:behavior-monitor-state', {
        isActive: data.isActive,
      });

      return { success: true };
    } catch (error) {
      console.error('[Gateway] Error toggling behavior monitor:', error);
      this.eventService.emitError(
        client,
        'Failed to toggle behavior monitoring',
        'BEHAVIOR_MONITOR_ERROR',
      );
      return { success: false };
    }
  }

  @SubscribeMessage('sfu:send-behavior-logs')
  async handleSendBehaviorLogs(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { peerId: string; roomId: string; behaviorLogs: any[] },
  ) {
    try {
      if (!data.peerId) {
        return { success: false, error: 'Participant not found' };
      }

      if (!data.behaviorLogs || data.behaviorLogs.length === 0) {
        return { success: false, error: 'No data to save' };
      }

      // Convert events to the format expected by the service
      const events = data.behaviorLogs.map((event) => ({
        type: event.type,
        value: String(event.value),
        time:
          event.time instanceof Date
            ? event.time.toISOString()
            : String(event.time),
      }));

      await this.interactionClient.saveUserBehavior(
        data.peerId,
        data.roomId,
        events,
      );

      return { success: true };
    } catch (error) {
      console.error('[Gateway] Error saving behavior logs:', error);
      return { success: false, error: 'Failed to save behavior logs' };
    }
  }

  @SubscribeMessage('sfu:download-room-log')
  async handleDownloadRoomLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; peerId: string },
  ) {
    try {
      const roomId = data.roomId;
      const peerId = data.peerId;

      // Check if user is creator
      const isCreator = await this.checkIfUserIsCreator(peerId, roomId);
      if (!isCreator) {
        return {
          success: false,
          error: 'Only room creator can download log file',
        };
      }

      // Turn off monitoring
      this.io.to(roomId).emit('sfu:behavior-monitor-state', {
        isActive: false,
      });

      // Wait a bit for logs to be sent
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Generate Excel file
      const result = (await this.interactionClient.generateRoomLogExcel(
        roomId,
      )) as any;

      if (result.success && result.excel_data) {
        return {
          success: true,
          file: Buffer.from(result.excel_data).toString('base64'),
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to generate log file',
        };
      }
    } catch (error) {
      console.error('[Gateway] Error generating room log:', error);
      return { success: false, error: 'Failed to generate log file' };
    }
  }

  @SubscribeMessage('sfu:download-user-log')
  async handleDownloadUserLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; peerId: string; creatorId: string },
  ) {
    try {
      const roomId = data.roomId;
      const peerId = data.peerId;
      const creatorId = data.creatorId;

      // Check if requester is creator
      const isCreator = await this.checkIfUserIsCreator(creatorId, roomId);
      if (!isCreator) {
        return {
          success: false,
          error: 'Only room creator can download log file',
        };
      }

      // Request user log from client
      this.io.to(roomId).emit('sfu:request-user-log', {
        peerId: peerId,
      });

      // Wait for logs to be sent
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Generate Excel file
      const result = (await this.interactionClient.generateUserLogExcel(
        roomId,
        peerId,
      )) as any;

      if (result.success && result.excel_data) {
        return {
          success: true,
          file: Buffer.from(result.excel_data).toString('base64'),
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to generate log file',
        };
      }
    } catch (error) {
      console.error('[Gateway] Error generating user log:', error);
      return { success: false, error: 'Failed to generate log file' };
    }
  }

  // Helper method to check if a user is the creator of a room
  private async checkIfUserIsCreator(
    peerId: string,
    roomId: string,
  ): Promise<boolean> {
    try {
      const participant = await this.roomClient.getParticipantByPeerId(
        roomId,
        peerId,
      );
      return participant?.is_creator === true;
    } catch (error) {
      console.error('[Gateway] Error checking if user is creator:', error);
      return false;
    }
  }

  // Helper methods
  private getParticipantBySocketId(socketId: string): string {
    const peerId = this.connectionMap.get(socketId) || '';
    return peerId;
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
    } else {
      console.log(
        `[Gateway] No peerId found for socketId=${socketId} during cleanup`,
      );
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
