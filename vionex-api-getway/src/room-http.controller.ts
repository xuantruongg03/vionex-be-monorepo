import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RoomClientService } from './clients/room.client';
import { HttpBroadcastService } from './services/http-broadcast.service';
import { Participant, Stream } from './interfaces/interface';
import * as mediasoupTypes from 'mediasoup/node/lib/types';
import { WebSocketEventService } from './services/websocket-event.service';
import { Socket } from 'socket.io';

// Simple JWT guard implementation
class AuthGuard {
  canActivate(context: any): boolean {
    // TODO: Implement JWT validation
    return true;
  }
}

@Controller('api/room')
@UseGuards(AuthGuard)
export class RoomHttpController {
  constructor(
    private readonly roomClient: RoomClientService,
    private readonly eventService: WebSocketEventService,
    private readonly broadcastService: HttpBroadcastService,
  ) {}

  @Post('authenticate')
  async authenticate(@Body() body: { peerId: string }) {
    // TODO: Generate proper JWT token
    const token = `jwt-token-${body.peerId}-${Date.now()}`;

    return {
      success: true,
      token,
      peerId: body.peerId,
    };
  }

  @Post(':roomId/join')
  async joinRoom(
    @Param('roomId') roomId: string,
    @Body() body: { peerId: string; password?: string },
    @Req() req: any,
  ) {
    try {
      // Validate room access
      const isLocked = await this.roomClient.isRoomLocked(roomId);
      if (isLocked && !body.password) {
        throw new BadRequestException('Room password required');
      }
      if (
        isLocked &&
        body.password &&
        !(await this.roomClient.verifyRoomPassword(roomId, body.password))
      ) {
        throw new UnauthorizedException('Invalid room password');
      }

      // Create room if needed
      let room = await this.roomClient.getRoom(roomId);
      if (!room.data?.room_id) {
        await this.roomClient.createRoom(roomId);
        // Note: Media room creation is now handled by SFU service via WebSocket
        room = await this.roomClient.getRoom(roomId);
      }

      // Check duplicate peerId
      if (room.data?.participants?.some((p) => p.peerId === body.peerId)) {
        throw new ConflictException('Peer ID already in use');
      }

      // Create participant
      const participant: Participant = {
        socket_id: `pending-ws-${roomId}-${body.peerId}`, // Will be updated when WebSocket connects, format: pending-ws-{roomId}-{peerId}
        peer_id: body.peerId,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        is_creator: !room.data?.participants?.length,
        time_arrive: new Date(),
      };

      await this.roomClient.setParticipant(roomId, participant);

      // Note: Router capabilities are now handled via WebSocket connection
      // Get router capabilities
      // const router = await this.signalingClient.createMediaRoom(roomId);

      // Broadcast via WebSocket to other clients
      this.broadcastService.broadcastToRoom(roomId, 'sfu:new-peer-join', {
        roomId,
        user: {
          peerId: participant.peer_id,
          isCreator: participant.is_creator,
          timeArrive: participant.time_arrive,
        },
      });

      return {
        success: true,
        peerId: participant.peer_id,
        isCreator: participant.is_creator,
        roomId,
        rtpCapabilities: null, // Will be provided via WebSocket
      };
    } catch (error) {
      console.error('[HTTP] Join room error:', error);
      throw error;
    }
  }

  @Post(':roomId/rtp-capabilities')
  async setRtpCapabilities(
    @Param('roomId') roomId: string,
    @Body()
    body: { rtpCapabilities: mediasoupTypes.RtpCapabilities; peerId: string },
  ) {
    try {
      const peerId = body.peerId;

      if (!peerId) {
        throw new BadRequestException('Peer ID required');
      }
      const participant = await this.roomClient.getParticipantByPeerId(
        roomId,
        peerId,
      );

      if (!participant) {
        try {
          const room = await this.roomClient.getRoom(roomId);
          const roomParticipant = room.data?.participants?.find(
            (p) => p.peerId === peerId || p.peer_id === peerId,
          );

          if (roomParticipant) {
          } else {
            throw new NotFoundException('Not in room');
          }
        } catch (error) {
          throw new NotFoundException('Not in room');
        }
      } // Update participant's RTP capabilities
      if (participant) {
        participant.rtp_capabilities = body.rtpCapabilities;
        // TODO: Update participant in room service
        await this.roomClient.updateParticipantRtpCapabilities(
          peerId,
          participant,
        );
      }
      return {
        success: true,
        message: 'RTP capabilities set successfully',
      };
    } catch (error) {
      console.error('[HTTP] Set RTP capabilities error:', error);
      throw error;
    }
  }

  @Get(':roomId/users')
  async getRoomUsers(@Param('roomId') roomId: string, @Req() req: any) {
    try {
      const room = await this.roomClient.getRoom(roomId);
      if (!room.data) {
        throw new NotFoundException('Room not found');
      }

      const users =
        room.data?.participants?.map((p) => ({
          peerId: p.peerId || p.peer_id,
          isCreator: p.isCreator || p.is_creator,
          timeArrive: p.timeArrive || p.time_arrive,
        })) || [];

      return {
        success: true,
        users,
      };
    } catch (error) {
      console.error('[HTTP] Get users error:', error);
      throw error;
    }
  }

  @Get(':roomId/streams')
  async getRoomStreams(@Param('roomId') roomId: string, @Req() req: any) {
    try {
      // Note: Stream management is now handled via WebSocket
      // Use SFU service directly via WebSocket for better real-time updates
      return {
        success: true,
        streams: [],
        message: 'Use WebSocket connection for real-time stream management',
      };
    } catch (error) {
      console.error('[HTTP] Get streams error:', error);
      throw error;
    }
  }
  @Post(':roomId/transports')
  async createTransport(
    @Param('roomId') roomId: string,
    @Body() body: { isProducer: boolean; peerId: string },
  ) {
    return {
      success: false,
      message:
        'Transport creation is now handled via WebSocket connection. Please use WebSocket API.',
      redirectTo: 'WebSocket sfu:create-transport event',
    };
  }

  @Post(':roomId/transports/:transportId/connect')
  async connectTransport(
    @Param('roomId') roomId: string,
    @Param('transportId') transportId: string,
    @Body() body: { dtlsParameters: any; peerId: string },
    @Req() req: any,
  ) {
    return {
      success: false,
      message:
        'Transport connection is now handled via WebSocket. Please use WebSocket API.',
      redirectTo: 'WebSocket sfu:connect-transport event',
    };
  }

  @Post(':roomId/produce')
  async produce(
    @Param('roomId') roomId: string,
    @Body()
    body: {
      transportId: string;
      kind: mediasoupTypes.MediaKind;
      rtpParameters: mediasoupTypes.RtpParameters;
      metadata: any;
      peerId: string;
    },
    @Req() req: any,
  ) {
    return {
      success: false,
      message:
        'Media production is now handled via WebSocket. Please use WebSocket API.',
      redirectTo: 'WebSocket sfu:produce event',
    };
  }

  @Post(':roomId/consume')
  async consume(
    @Param('roomId') roomId: string,
    @Body()
    body: {
      streamId: string;
      transportId: string;
      peerId: string;
      client: Socket; // Optional client ID for WebSocket
    },
  ) {
    return {
      success: false,
      message:
        'Media consumption is now handled via WebSocket. Please use WebSocket API.',
      redirectTo: 'WebSocket sfu:consume event',
    };
  }

  @Post(':roomId/consumers/:consumerId/resume')
  async resumeConsumer(
    @Param('roomId') roomId: string,
    @Param('consumerId') consumerId: string,
    @Body() body: { peerId: string },
    @Req() req: any,
  ) {
    return {
      success: false,
      message:
        'Consumer resume is now handled via WebSocket. Please use WebSocket API.',
      redirectTo: 'WebSocket sfu:resume-consumer event',
    };
  }

  @Delete(':roomId/streams/:streamId')
  async unpublish(
    @Param('roomId') roomId: string,
    @Param('streamId') streamId: string,
    @Body() body: { peerId: string },
    @Req() req: any,
  ) {
    return {
      success: false,
      message:
        'Stream unpublishing is now handled via WebSocket. Please use WebSocket API.',
      redirectTo: 'WebSocket sfu:unpublish event',
    };
  }

  @Patch(':roomId/streams/:streamId')
  async updateStream(
    @Param('roomId') roomId: string,
    @Param('streamId') streamId: string,
    @Body() body: { metadata: any; peerId: string },
    @Req() req: any,
  ) {
    return {
      success: false,
      message:
        'Stream updates are now handled via WebSocket. Please use WebSocket API.',
      redirectTo: 'WebSocket sfu:update-stream event',
    };
  }

  @Post(':roomId/leave')
  async leaveRoom(
    @Param('roomId') roomId: string,
    @Body() body: { peerId: string },
    @Req() req: any,
  ) {
    try {
      console.log(`[HTTP] Leave room: ${roomId}, peerId: ${body.peerId}`);

      const participant = await this.roomClient.getParticipantByPeerId(
        roomId,
        body.peerId,
      );

      if (!participant) {
        return { success: true, message: 'Already left' }; // Already left
      }

      // Use room client directly to leave room
      await this.roomClient.leaveRoom({
        roomId,
        participantId: participant.peer_id,
        socketId: participant.socket_id,
      });

      // Broadcast via WebSocket
      this.broadcastService.broadcastToRoom(roomId, 'peer-left', {
        roomId,
        peerId: participant.peer_id,
      });

      console.log(`[HTTP] Left room: ${roomId}, peerId: ${body.peerId}`);

      return {
        success: true,
        message: 'Left room successfully',
      };
    } catch (error) {
      console.error('[HTTP] Leave room error:', error);
      throw error;
    }
  }
}
