import * as mediasoupTypes from 'mediasoup/node/lib/types';
import { Observable } from 'rxjs';

export interface Stream {
  streamId: string;
  publisherId: string;
  producerId: string;
  metadata: any;
  rtpParameters: mediasoupTypes.RtpParameters;
  roomId: string;
}

export interface Participant {
  socketId: string;
  peerId: string;
  rtpCapabilities?: mediasoupTypes.RtpCapabilities;
  transports: Map<string, mediasoupTypes.WebRtcTransport>;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
  isCreator: boolean;
  timeArrive: Date;
}

export interface MediaRoom {
  router: mediasoupTypes.Router;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer[]>;
}

export interface RoomGrpcService {
  leaveRoom(data: {
    room_id: string;
    participant_id: string;
    socket_id: string;
  }): Observable<{
    success: boolean;
    message: string;
    removed_streams: string[];
    new_creator?: any;
    is_room_empty: boolean;
    participant_id: string;
  }>;
}

export interface PlanRTP{
  roomId: string;
  peerId: string;
  port?: number; // Optional port for audio service
  rtpParameters: mediasoupTypes.RtpParameters;
  transportId: string;
}

// Speaking management interfaces
export interface HandleSpeakingRequest {
  room_id: string;
  peer_id: string;
  port: number; // Optional port for audio service
}

export interface HandleSpeakingResponse {
  status: string;
  message: string;
}

export interface HandleStopSpeakingRequest {
  room_id: string;
  peer_id: string;
}

export interface HandleStopSpeakingResponse {
  status: string;
  message: string;
}

export interface GetActiveSpeakersRequest {
  room_id: string;
}

export interface GetActiveSpeakersResponse {
  active_speakers: ActiveSpeaker[];
}

export interface ActiveSpeaker {
  peer_id: string;
  last_speak_time: string;
}

export interface RoomPassword {
  password: string;
  creatorId: string;
}

export interface MediaRoomInfo {
  router: mediasoupTypes.Router | null;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer[]>;
  workerId?: string;
}