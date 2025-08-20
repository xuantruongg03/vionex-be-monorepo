import { Observable } from 'rxjs/internal/Observable';

export default interface AudioGRPCService {
    // Legacy methods
    allocateTranslationPort(data: {
        roomId: string;
        userId: string;
    }): Observable<{
        success: boolean;
        port: number;
        send_port: number;
        ssrc: number;
    }>;

    releasePort(data: {
        roomId: string;
        userId: string;
    }): Observable<{ success: boolean }>;

    // New audio buffer processing methods
    processAudioBuffer(data: {
        userId: string;
        roomId: string;
        timestamp: number;
        buffer: Uint8Array;
        duration: number;
        sampleRate: number;
        channels: number;
    }): Observable<{
        success: boolean;
        transcript?: string;
        confidence?: number;
        message?: string;
    }>;

    processAudioChunk(data: {
        roomId: string;
        userId: string;
        timestamp: number;
        audioBuffer: Uint8Array;
        duration: number;
    }): Observable<{ success: boolean; message: string }>;

    // Translation Cabin methods
    createTranslationProduce(data: {
        roomId: string;
        userId: string;
        sourceLanguage: string;
        targetLanguage: string;
    }): Observable<{
        success: boolean;
        streamId?: string;
        message?: string;
    }>;

    destroyTranslationCabin(data: {
        room_id: string;
        target_user_id: string;
        source_language: string;
        target_language: string;
    }): Observable<{ success: boolean; message?: string }>;

}
