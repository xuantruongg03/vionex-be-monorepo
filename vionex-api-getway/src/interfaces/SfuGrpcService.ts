import { Observable } from 'rxjs/internal/Observable';

// SFU gRPC service interface based on proto
export default interface SfuGrpcService {
    // Media room management
    createMediaRoom(data: { room_id: string }): any;

    closeMediaRoom(data: { room_id: string }): any;

    getMediaRouter(data: { room_id: string }): any;

    // Transport management
    createTransport(data: { room_id: string; is_producer: boolean }): any;

    connectTransport(data: {
        transport_id: string;
        dtls_parameters: string;
        participant_data: string;
    }): any;

    // Producer/Consumer management
    createProducer(data: {
        transport_id: string;
        kind: string;
        rtp_parameters: string;
        metadata: string;
        room_id: string;
        participant_data: string;
    }): any;

    createConsumer(data: {
        stream_id: string;
        transport_id: string;
        room_id: string;
        peer_id: string;
        rtp_capabilities: string;
        participant_data: string;
    }): any;
    resumeConsumer(data: {
        consumer_id: string;
        room_id: string;
        peer_id: string;
    }): any;

    // Stream management
    getStreams(data: { room_id: string }): any;

    saveStream(data: {
        stream_id: string;
        publisher_id: string;
        producer_id: string;
        metadata: string;
        rtp_parameters: string;
        room_id: string;
    }): any;

    updateStream(data: {
        stream_id: string;
        participant_id: string;
        metadata: string;
        room_id: string;
    }): any;

    removeStream(data: { stream_id: string }): any;

    unpublishStream(data: {
        room_id: string;
        stream_id: string;
        participant_id: string;
    }): any;

    // Participant management
    removeParticipantMedia(data: {
        room_id: string;
        participant_id: string;
    }): any;

    // Presence
    handlePresence(data: {
        room_id: string;
        peer_id: string;
        metadata: string;
    }): any;

    pinUser(data: {
        room_id: string;
        pinner_peer_id: string;
        pinned_peer_id: string;
        transport_id: string;
        rtp_capabilities: string;
    }): any;

    unpinUser(data: {
        room_id: string;
        unpinner_peer_id: string;
        unpinned_peer_id: string;
    }): any;

    // Speaking management
    handleSpeaking(data: {
        room_id: string;
        peer_id: string;
        port: number;
    }): any;

    handleStopSpeaking(data: { room_id: string; peer_id: string }): any;

    getActiveSpeakers(data: { room_id: string }): any;

    // Enhanced Translation Cabin management
    allocatePort(data: {
        room_id: string;
        source_user_id: string;
        target_user_id: string;
        source_language: string;
        target_language: string;
        audio_port: number;
        send_port?: number; // Added for bidirectional support
        ssrc: number;
    }): Observable<{
        success: boolean;
        stream_id?: string; // Proto field name
        message?: string;
        sfu_listen_port?: number; // NAT FIX: Return SFU listen port
        consumer_ssrc?: number; // Actual consumer SSRC for Audio Service RTP routing
    }>;

    // createBidirectionalTranslation(data: {
    //     room_id: string;
    //     target_peer_id: string;
    //     source_language: string;
    //     target_language: string;
    //     receive_port: number;
    //     send_port: number;
    // }): Observable<{ success: boolean; message?: string; streamId?: string }>;

    destroyTranslationCabin(data: {
        room_id: string;
        source_user_id: string;
        target_user_id: string;
        source_language: string;
        target_language: string;
    }): Observable<{ success: boolean; message?: string }>;

    listTranslationCabin(data: {
        room_id: string;
        user_id: string;
    }): Observable<{
        success: boolean;
        cabins: Array<{
            target_user_id: string;
            source_language: string;
            target_language: string;
        }>;
    }>;
}
