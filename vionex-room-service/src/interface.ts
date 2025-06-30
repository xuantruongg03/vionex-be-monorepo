import * as mediasoupTypes from 'mediasoup/node/lib/types';

export interface Participant {
  socket_id: string;
  peer_id: string;
  rtp_capabilities?: mediasoupTypes.RtpCapabilities;
  transports: Map<string, mediasoupTypes.WebRtcTransport>;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
  is_creator: boolean;
  time_arrive: Date;
}
export interface RoomPassword {
  password: string;
  creator_id: string;
}
export interface Room {
  roomId: string;
  password?: string;
  participants: Map<string, Participant>;
  createdAt: Date;
}

interface IsRoomExistsRequest {
  room_id: string;
}

interface IsRoomExistsResponse {
  is_exists: boolean;
}

interface CreateRoomRequest {
  room_id: string;
}

interface CreateRoomResponse {
  room_id: string;
  message: string;
  success: boolean;
}

interface JoinRoomRequest {
  room_id: string;
  user_id: string;
}

interface JoinRoomResponse {
  success: boolean;
  message: string;
}

interface LeaveRoomRequest {
  room_id: string;
  participant_id: string;
  socket_id: string;
}

interface LeaveRoomResponse {
  success: boolean;
  message: string;
  removed_streams?: string[];
  new_creator?: string | null;
  is_room_empty?: boolean;
  participant_id?: string;
}

interface IsRoomLockedRequest {
  room_id: string;
}

interface IsRoomLockedResponse {
  locked: boolean;
}

interface VerifyRoomPasswordRequest {
  room_id: string;
  password: string;
}

interface VerifyRoomPasswordResponse {
  valid: boolean;
}

interface GetRoomRequest {
  room_id: string;
}

interface GetRoomResponse {
  success: boolean;
  data: {
    room_id: string;
    participants: Participant[];
    isLocked?: boolean;
  } | null;
}

interface SetParticipantRequest {
  room_id: string;
  participant: any;
}

interface SetParticipantResponse {
  success: boolean;
  message: string;
}

interface GetParticipantsRequest {
  room_id: string;
}

interface GetParticipantsResponse {
  participants: any[];
}

interface GetParticipantBySocketIdRequest {
  socket_id: string;
}

interface GetParticipantBySocketIdResponse {
  participant: any;
}

interface GetParticipantByPeerIdRequest {
  peer_id: string;
  room_id: string;
}

interface GetParticipantByPeerIdResponse {
  participant: Participant | null;
}

interface RemoveParticipantRequest {
  room_id: string;
  peer_id: string;
}

interface RemoveParticipantResponse {
  success: boolean;
  message: string;
}

interface SetTransportRequest {
  room_id: string;
  transport_data: string;
  peer_id: string;
}

interface SetTransportResponse {
  success: boolean;
  message: string;
}

interface SetProducerRequest {
  room_id: string;
  producer_data: string;
  peer_id: string;
}

interface SetProducerResponse {
  success: boolean;
  message: string;
}

interface GetParticipantRoomRequest {
  peer_id: string;
}

interface GetParticipantRoomResponse {
  room_id: string;
}

interface RemoveProducerFromParticipantRequest {
  room_id: string;
  peer_id: string;
  producer_id: string;
}

interface RemoveProducerFromParticipantResponse {
  success: boolean;
  message: string;
}

export {
  IsRoomExistsRequest,
  IsRoomExistsResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  LeaveRoomRequest,
  LeaveRoomResponse,
  IsRoomLockedRequest,
  IsRoomLockedResponse,
  VerifyRoomPasswordRequest,
  VerifyRoomPasswordResponse,
  GetRoomRequest,
  GetRoomResponse,
  SetParticipantRequest,
  SetParticipantResponse,
  GetParticipantsRequest,
  GetParticipantsResponse,
  GetParticipantBySocketIdRequest,
  GetParticipantBySocketIdResponse,
  GetParticipantByPeerIdRequest,
  GetParticipantByPeerIdResponse,
  RemoveParticipantRequest,
  RemoveParticipantResponse,
  SetTransportRequest,
  SetTransportResponse,
  SetProducerRequest,
  SetProducerResponse,
  GetParticipantRoomRequest,
  GetParticipantRoomResponse,
  RemoveProducerFromParticipantRequest,
  RemoveProducerFromParticipantResponse,
};
