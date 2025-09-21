import { Injectable } from '@nestjs/common';
import { SfuClientService } from '../clients/sfu.client';
import { RoomClientService } from '../clients/room.client';
import { HttpBroadcastService } from './http-broadcast.service';

@Injectable()
export class StreamService {
    constructor(
        private readonly sfuClient: SfuClientService,
        private readonly roomClient: RoomClientService,
        private readonly broadcastService: HttpBroadcastService,
    ) {}

    /**
     * Unpublish a stream by streamId
     * Handles both individual stream cleanup and broadcasting events
     */
    async unpublishStream(data: {
        streamId: string;
        roomId: string;
        participantId: string;
    }): Promise<{ success: boolean; message: string }> {
        try {
            const { streamId, roomId, participantId } = data;

            console.log(
                `[StreamService] Unpublishing stream ${streamId} from participant ${participantId} in room ${roomId}`,
            );

            // Get stream metadata before unpublishing to determine if it's screen share
            let isScreenShare = false;
            try {
                const streamsResponse = await this.sfuClient.getStreams(roomId);
                const streams = (streamsResponse as any)?.streams || [];

                // Try to find by streamId first, then by producerId
                let foundStream = streams.find(
                    (s: any) => (s.streamId || s.stream_id) === streamId,
                );

                // If not found by streamId, try to find by producerId (UUID format)
                if (!foundStream) {
                    foundStream = streams.find(
                        (s: any) =>
                            (s.producerId || s.producer_id) === streamId,
                    );
                }

                if (foundStream && foundStream.metadata) {
                    const metadata =
                        typeof foundStream.metadata === 'string'
                            ? JSON.parse(foundStream.metadata)
                            : foundStream.metadata;
                    isScreenShare =
                        metadata?.isScreenShare ||
                        metadata?.type === 'screen' ||
                        metadata?.type === 'screen_audio' ||
                        false;
                }
            } catch (metadataError) {
                isScreenShare = streamId.includes('screen') || false;

                // Additional check: if streamId is UUID format, check metadata from different source
                if (
                    !isScreenShare &&
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                        streamId,
                    )
                ) {
                    // For UUID format, we need better detection - this will be enhanced
                }
            }

            // Method 1: Try to unpublish specific stream first (preferred method)
            try {
                await this.sfuClient.unpublishStream({
                    room_id: roomId,
                    stream_id: streamId,
                    participant_id: participantId,
                });
            } catch (error) {
                // Check if error is due to stream not found (race condition)
                const errorMsg = error?.message || error?.toString() || '';
                if (
                    errorMsg.includes('not found') ||
                    errorMsg.includes('Not found')
                ) {
                } else {
                    console.warn(
                        `[StreamService] unpublishStream failed for ${streamId}, trying removeStream:`,
                        error,
                    );

                    // Method 2: Fallback to removeStream
                    try {
                        await this.sfuClient.removeStream({
                            stream_id: streamId,
                        });
                        console.log(
                            `[StreamService] Successfully removed stream ${streamId} via removeStream`,
                        );
                    } catch (removeError) {
                        const removeErrorMsg =
                            removeError?.message ||
                            removeError?.toString() ||
                            '';
                        if (
                            removeErrorMsg.includes('not found') ||
                            removeErrorMsg.includes('Not found')
                        ) {
                            console.log(
                                `[StreamService] Stream ${streamId} already removed via removeStream - race condition, treating as success`,
                            );
                        } else {
                            console.warn(
                                `[StreamService] removeStream also failed for ${streamId}, trying removeParticipantMedia:`,
                                removeError,
                            );

                            // Method 3: Last resort - removeParticipantMedia (this will remove all media for participant)
                            const removeMediaResponse =
                                await this.sfuClient.removeParticipantMedia({
                                    room_id: roomId,
                                    participant_id: participantId,
                                });

                            if (
                                removeMediaResponse &&
                                (removeMediaResponse as any).removed_streams
                            ) {
                                console.log(
                                    `[StreamService] removeParticipantMedia removed streams:`,
                                    (removeMediaResponse as any)
                                        .removed_streams,
                                );
                            }
                        }
                    }
                }
            }

            // Broadcast stream-removed event to all clients in the room
            this.broadcastService.broadcastToRoom(
                roomId,
                'sfu:stream-removed',
                {
                    streamId: streamId,
                    publisherId: participantId,
                    roomId: roomId,
                    isScreenShare: isScreenShare,
                },
            );

            return {
                success: true,
                message: 'Stream unpublished successfully',
            };
        } catch (error) {
            console.error(`[StreamService] Error unpublishing stream:`, error);
            return {
                success: false,
                message: error.message || 'Failed to unpublish stream',
            };
        }
    }

    /**
     * Unpublish multiple streams for a participant
     * Useful for cleanup when user leaves room
     */
    async unpublishParticipantStreams(data: {
        roomId: string;
        participantId: string;
        streamIds?: string[]; // Optional specific streams to remove
    }): Promise<{
        success: boolean;
        message: string;
        removedStreams: string[];
    }> {
        try {
            const { roomId, participantId, streamIds } = data;

            // Remove all participant media via SFU
            const removeMediaResponse =
                await this.sfuClient.removeParticipantMedia({
                    room_id: roomId,
                    participant_id: participantId,
                });

            // Extract removed streams from response
            const removedStreams: string[] = [];
            if (
                removeMediaResponse &&
                (removeMediaResponse as any).removed_streams
            ) {
                removedStreams.push(
                    ...(removeMediaResponse as any).removed_streams,
                );
            }

            // If specific streamIds were provided but not found in removed_streams, add them
            if (streamIds && streamIds.length > 0) {
                for (const streamId of streamIds) {
                    if (!removedStreams.includes(streamId)) {
                        removedStreams.push(streamId);
                    }
                }
            }

            // Broadcast stream-removed events for each removed stream
            for (const streamId of removedStreams) {
                this.broadcastService.broadcastToRoom(
                    roomId,
                    'sfu:stream-removed',
                    {
                        streamId: streamId,
                        publisherId: participantId,
                        roomId: roomId,
                    },
                );
            }

            return {
                success: true,
                message: `Successfully unpublished ${removedStreams.length} streams`,
                removedStreams,
            };
        } catch (error) {
            console.error(
                `[StreamService] Error unpublishing participant streams:`,
                error,
            );
            return {
                success: false,
                message:
                    error.message || 'Failed to unpublish participant streams',
                removedStreams: [],
            };
        }
    }

    /**
     * Check if a stream belongs to a participant
     * Useful for authorization checks
     */
    async verifyStreamOwnership(
        streamId: string,
        participantId: string,
        roomId: string,
    ): Promise<boolean> {
        try {
            // Get all streams in room
            const streamsResponse = await this.sfuClient.getStreams(roomId);
            const streams = (streamsResponse as any)?.streams || [];

            // Find the stream and check ownership
            const stream = streams.find(
                (s: any) => (s.streamId || s.stream_id) === streamId,
            );

            if (!stream) {
                return true;
            }

            const publisherId = stream.publisherId || stream.publisher_id;
            const isOwner = publisherId === participantId;

            console.log(
                `[StreamService] Stream ${streamId} ownership check: ${isOwner} (owner: ${publisherId}, requester: ${participantId})`,
            );

            return isOwner;
        } catch (error) {
            console.error(
                `[StreamService] Error verifying stream ownership:`,
                error,
            );
            return false;
        }
    }
}
