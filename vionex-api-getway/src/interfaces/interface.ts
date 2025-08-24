import * as mediasoupTypes from 'mediasoup/node/lib/types';
import { Observable } from 'rxjs';

export interface Participant {
    socket_id: string;
    peer_id: string;
    rtp_capabilities?: mediasoupTypes.RtpCapabilities;
    transports: Map<string, mediasoupTypes.WebRtcTransport>;
    producers: Map<string, mediasoupTypes.Producer>;
    consumers: Map<string, mediasoupTypes.Consumer>;
    is_creator: boolean;
    time_arrive: Date;
    name?: string;
    isAudioEnabled?: boolean;
    isVideoEnabled?: boolean;
    isHost?: boolean;
    // Organization room context
    organizationId?: string;
    roomId?: string;
}

export interface ChatMessage {
    id: string;
    room_id: string;
    sender: string;
    sender_name: string;
    text: string;
    timestamp?: string;
    fileUrl?: string;
    fileName?: string;
    fileType?: string;
    fileSize?: number;
    isImage?: boolean;
}

export interface Stream {
    streamId: string;
    publisherId: string;
    producerId: string;
    metadata: any;
    rtpParameters: mediasoupTypes.RtpParameters;
    roomId: string;
}

// Proto response Stream format (snake_case)
export interface ProtoStream {
    stream_id: string;
    publisher_id: string;
    producer_id: string;
    metadata: string; // JSON string
    rtp_parameters: string; // JSON string
    room_id: string;
}

export interface ChatBotGrpcServiceInterface {
    askChatBot(data: {
        question: string;
        room_id: string;
    }): Observable<{ answer: string }>;
}

export interface RoomGrpcService {
    lockRoom(data: {
        room_id: string;
        password: string;
        creator_id: string;
    }): any;

    unlockRoom(data: { room_id: string; creator_id: string }): any;

    isRoomLocked(data: { room_id: string }): any;

    verifyRoomPassword(data: { room_id: string; password: string }): any;
    getParticipantByPeerId(data: {
        peer_id: string;
        room_id: string;
    }): Observable<Participant>;

    isUsernameAvailable(data: {
        room_id: string;
        username: string;
    }): Observable<{ success: boolean; message?: string }>;

    isRoomExists(data: { room_id: string }): Observable<{ is_exists: boolean }>;

    createRoom(data: {
        room_id: string;
    }): Observable<{ room_id: string; message: string; success: boolean }>;

    joinRoom(data: {
        room_id: string;
        user_id: string;
    }): Observable<{ success: boolean; message: string }>;

    isRoomLocked(data: { room_id: string }): Observable<{ locked: boolean }>;

    verifyRoomPassword(data: {
        room_id: string;
        password: string;
    }): Observable<{ valid: boolean }>;

    getRoom(data: { room_id: string }): Observable<{
        message: string;
        data: {
            room_id: string;
            participants: any;
            isLocked: boolean;
        };
    }>;

    setParticipant(data: {
        room_id: string;
        participant: any;
    }): Observable<{ success: boolean; message: string }>;

    getParticipants(data: { room_id: string }): Observable<any[]>;

    getParticipantByPeerId(data: {
        room_id: string;
        peer_id: string;
    }): Observable<{ participant: Participant | null }>;

    getParticipantBySocketId(data: {
        socket_id: string;
    }): Observable<{ participant: any }>;

    removeParticipant(data: {
        room_id: string;
        peer_id: string;
    }): Observable<{ success: boolean; message: string }>;

    setTransport(data: {
        room_id: string;
        transport_data: string; // JSON string to match proto
        peer_id: string;
    }): Observable<{ success: boolean; message: string }>;

    setProducer(data: {
        room_id: string;
        producer: any;
        peer_id: string;
    }): Observable<{ success: boolean; message: string }>;

    getParticipantRoom(data: {
        peer_id: string;
    }): Observable<{ room_id: string | null }>;

    removeProducerFromParticipant(data: {
        room_id: string;
        peer_id: string;
        producer_id: string;
    }): Observable<{ success: boolean; message: string }>;

    updateParticipantRtpCapabilities(data: {
        peer_id: string;
        rtp_capabilities: string;
    }): Observable<{ success: boolean; message?: string; error?: string }>;

    leaveRoom(data: {
        room_id: string;
        participant_id: string;
        socket_id: string;
    }): Observable<{
        status: string;
        message: string;
        is_room_empty: boolean;
        new_creator_data: string;
    }>;

    // Organization Room Methods
    getOrgRooms(data: { user_id: string; org_id: string }): Observable<{
        success: boolean;
        message: string;
        rooms?: any[];
    }>;

    verifyRoomAccess(data: {
        user_id: string;
        room_id: string;
        org_id?: string;
        user_role?: string;
        password?: string;
    }): Observable<{
        can_join: boolean;
        reason?: string;
    }>;

    createOrgRoom(data: {
        user_id: string;
        org_id: string;
        name: string;
        description: string;
        is_public: boolean;
        password: string;
    }): Observable<{
        success: boolean;
        message: string;
        room_id?: string;
    }>;
}

export interface ChatGRPCService {
    sendMessage(data: {
        room_id: string;
        sender: string;
        sender_name: string;
        text: string;
        fileUrl?: string;
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        isImage?: boolean;
    }): Observable<{ success: boolean; message: ChatMessage | null }>;

    getMessages(data: {
        room_id: string;
    }): Observable<{ success: boolean; messages: ChatMessage[] }>;

    removeRoomMessages(data: {
        room_id: string;
    }): Observable<{ success: boolean; message: string }>;
}

// Behavior monitoring interfaces
export interface UserEvent {
    type: string;
    value: boolean | string | number;
    time: Date;
}

export interface UserBehaviorLog {
    userId: string;
    roomId: string;
    events: UserEvent[];
    lastUpdated: Date;
}

export interface BehaviorLogRequest {
    userId: string;
    roomId: string;
    events: UserEvent[];
}
