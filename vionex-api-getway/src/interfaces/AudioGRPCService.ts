import { Observable } from 'rxjs/internal/Observable';

/**
 * Audio gRPC Service Interface
 *
 * Defines the contract for audio processing and translation cabin operations.
 * Maps to the audio.proto service definition.
 */
export default interface AudioGRPCService {
    /**
     * Allocate translation ports for bidirectional audio streaming
     * Legacy method for port-based cabin setup
     *
     * @param data - Room and user identification
     * @returns Observable with allocated ports and SSRC
     */
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

    /**
     * Release previously allocated translation ports
     * Cleanup method for port-based resources
     *
     * @param data - Room and user identification
     * @returns Observable with operation status
     */
    releasePort(data: {
        roomId: string;
        userId: string;
    }): Observable<{ success: boolean }>;

    /**
     * Process audio buffer for speech recognition
     * Advanced audio processing with detailed parameters
     *
     * @param data - Audio buffer with metadata
     * @returns Observable with transcription results
     */
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

    /**
     * Process audio chunk (legacy method)
     * Simple audio chunk processing for compatibility
     *
     * @param data - Audio chunk with basic metadata
     * @returns Observable with processing status
     */
    processAudioChunk(data: {
        roomId: string;
        userId: string;
        timestamp: number;
        audioBuffer: Uint8Array;
        duration: number;
    }): Observable<{ success: boolean; message: string }>;

    /**
     * Create translation cabin producer
     * Initiates translation service for specified language pair
     *
     * @param data - Translation cabin configuration
     * @returns Observable with stream ID for consumption
     */
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

    /**
     * Destroy translation cabin
     * Cleanup translation resources and stop processing
     *
     * @param data - Cabin identification for destruction
     * @returns Observable with operation status
     */
    DestroyCabin(data: {
        room_id: string;
        target_user_id: string;
        source_language: string;
        target_language: string;
    }): Observable<{ success: boolean; message?: string }>;
}
