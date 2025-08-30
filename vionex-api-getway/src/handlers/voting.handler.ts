import { Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { InteractionClientService } from '../clients/interaction.client';
import { WebSocketEventService } from '../services/websocket-event.service';

// Define interfaces for voting responses
interface VoteSessionGrpc {
    id: string;
    room_id: string;
    question: string;
    options: Array<{ id: string; text: string; votes: number }>;
    creator_id: string;
    is_active: boolean;
    created_at: string;
    ended_at?: string;
    voters: string[];
}

interface VotingResponse {
    success: boolean;
    vote_session?: VoteSessionGrpc;
    error?: string;
}

@Injectable()
export class VotingHandler {
    constructor(
        private readonly interactionClient: InteractionClientService,
        private readonly eventService: WebSocketEventService,
    ) {
        console.log('[VotingHandler] VotingHandler initialized as service');
    }

    /**
     * Create a new voting session
     */
    async handleCreateVote(
        client: Socket,
        data: {
            roomId: string;
            question: string;
            options: { id: string; text: string }[];
            creatorId: string;
        },
    ) {
        try {
            console.log('[VotingHandler] Creating vote:', data);

            // Validate input
            if (
                !data.roomId ||
                !data.question ||
                !data.options ||
                data.options.length < 2
            ) {
                const errorMsg =
                    'Invalid vote data: roomId, question, and at least 2 options are required';
                console.error('[VotingHandler]', errorMsg);
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'INVALID_VOTE_DATA',
                });
                return { success: false, error: errorMsg };
            }

            // Call interaction service to create vote
            const result = (await this.interactionClient.createVote(
                data.roomId,
                data.question,
                data.options,
                data.creatorId,
            )) as VotingResponse;

            if (result && result.success && result.vote_session) {
                // Transform vote session data for frontend
                const voteSession = this.transformVoteSessionFromGrpc(
                    result.vote_session,
                );

                // Emit vote-created event to all clients in room
                this.eventService.emitToClient(
                    client,
                    'sfu:vote-created',
                    voteSession,
                );
                client.to(data.roomId).emit('sfu:vote-created', voteSession);

                console.log(
                    '[VotingHandler] Vote created successfully:',
                    voteSession.id,
                );
                return { success: true, voteSession };
            } else {
                const errorMsg = result?.error || 'Failed to create vote';
                console.error(
                    '[VotingHandler] Failed to create vote:',
                    errorMsg,
                );
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'CREATE_VOTE_FAILED',
                });
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error('[VotingHandler] Error creating vote:', error);
            this.eventService.emitToClient(client, 'sfu:vote-error', {
                message: 'Internal server error',
                code: 'CREATE_VOTE_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Submit a vote
     */
    async handleSubmitVote(
        client: Socket,
        data: {
            roomId: string;
            voteId: string;
            optionId: string;
            voterId: string;
        },
    ) {
        try {
            console.log('[VotingHandler] Submitting vote:', data);

            // Validate input
            if (
                !data.roomId ||
                !data.voteId ||
                !data.optionId ||
                !data.voterId
            ) {
                const errorMsg =
                    'Invalid vote submission data: roomId, voteId, optionId, and voterId are required';
                console.error('[VotingHandler]', errorMsg);
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'INVALID_VOTE_SUBMISSION',
                });
                return { success: false, error: errorMsg };
            }

            // Call interaction service to submit vote
            const result = (await this.interactionClient.submitVote(
                data.roomId,
                data.voteId,
                data.optionId,
                data.voterId,
            )) as VotingResponse;

            if (result && result.success && result.vote_session) {
                // Transform vote session data for frontend
                const voteSession = this.transformVoteSessionFromGrpc(
                    result.vote_session,
                );

                // Broadcast vote-updated event to ALL users in room
                // Frontend will handle filtering based on user status
                this.eventService.emitToClient(
                    client,
                    'sfu:vote-updated',
                    voteSession,
                );
                client.to(data.roomId).emit('sfu:vote-updated', voteSession);

                console.log(
                    '[VotingHandler] Vote submitted successfully by:',
                    data.voterId,
                );
                return { success: true, voteSession };
            } else {
                const errorMsg = result?.error || 'Failed to submit vote';
                console.error(
                    '[VotingHandler] Failed to submit vote:',
                    errorMsg,
                );
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'SUBMIT_VOTE_FAILED',
                });
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error('[VotingHandler] Error submitting vote:', error);
            this.eventService.emitToClient(client, 'sfu:vote-error', {
                message: 'Internal server error',
                code: 'SUBMIT_VOTE_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get vote results
     */
    async handleGetVoteResults(
        client: Socket,
        data: {
            roomId: string;
            voteId: string;
        },
    ) {
        try {
            console.log('[VotingHandler] Getting vote results:', data);

            // Validate input
            if (!data.roomId || !data.voteId) {
                const errorMsg =
                    'Invalid request: roomId and voteId are required';
                console.error('[VotingHandler]', errorMsg);
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'INVALID_GET_RESULTS_REQUEST',
                });
                return { success: false, error: errorMsg };
            }

            // Call interaction service to get vote results
            const result = (await this.interactionClient.getVoteResults(
                data.roomId,
                data.voteId,
            )) as VotingResponse;

            if (result && result.success && result.vote_session) {
                // Transform vote session data for frontend
                const voteSession = this.transformVoteSessionFromGrpc(
                    result.vote_session,
                );

                // Emit vote-results event to the requesting client
                this.eventService.emitToClient(
                    client,
                    'sfu:vote-results',
                    voteSession,
                );

                console.log(
                    '[VotingHandler] Vote results sent for vote:',
                    data.voteId,
                );
                return { success: true, voteSession };
            } else {
                const errorMsg = result?.error || 'Failed to get vote results';
                console.error(
                    '[VotingHandler] Failed to get vote results:',
                    errorMsg,
                );
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'GET_RESULTS_FAILED',
                });
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error('[VotingHandler] Error getting vote results:', error);
            this.eventService.emitToClient(client, 'sfu:vote-error', {
                message: 'Internal server error',
                code: 'GET_RESULTS_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * End a voting session
     */
    async handleEndVote(
        client: Socket,
        data: {
            roomId: string;
            voteId: string;
            creatorId: string;
        },
    ) {
        try {
            console.log('[VotingHandler] Ending vote:', data);

            // Validate input
            if (!data.roomId || !data.voteId || !data.creatorId) {
                const errorMsg =
                    'Invalid request: roomId, voteId, and creatorId are required';
                console.error('[VotingHandler]', errorMsg);
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'INVALID_END_VOTE_REQUEST',
                });
                return { success: false, error: errorMsg };
            }

            // Call interaction service to end vote
            const result = (await this.interactionClient.endVote(
                data.roomId,
                data.voteId,
                data.creatorId,
            )) as VotingResponse;

            if (result && result.success && result.vote_session) {
                // Transform vote session data for frontend
                const voteSession = this.transformVoteSessionFromGrpc(
                    result.vote_session,
                );

                // Emit vote-ended event to all clients in room
                this.eventService.emitToClient(
                    client,
                    'sfu:vote-ended',
                    voteSession,
                );
                client.to(data.roomId).emit('sfu:vote-ended', voteSession);

                console.log(
                    '[VotingHandler] Vote ended successfully:',
                    data.voteId,
                );
                return { success: true, voteSession };
            } else {
                const errorMsg = result?.error || 'Failed to end vote';
                console.error('[VotingHandler] Failed to end vote:', errorMsg);
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'END_VOTE_FAILED',
                });
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error('[VotingHandler] Error ending vote:', error);
            this.eventService.emitToClient(client, 'sfu:vote-error', {
                message: 'Internal server error',
                code: 'END_VOTE_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get active vote session
     */
    async handleGetActiveVote(
        client: Socket,
        data: {
            roomId: string;
        },
    ) {
        try {
            console.log('[VotingHandler] Getting active vote:', data);

            // Validate input
            if (!data.roomId) {
                const errorMsg = 'Invalid request: roomId is required';
                console.error('[VotingHandler]', errorMsg);
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'INVALID_GET_ACTIVE_VOTE_REQUEST',
                });
                return { success: false, error: errorMsg };
            }

            // Call interaction service to get active vote
            const result = (await this.interactionClient.getActiveVote(
                data.roomId,
            )) as VotingResponse;

            if (result && result.success) {
                if (result.vote_session) {
                    // Transform vote session data for frontend
                    const voteSession = this.transformVoteSessionFromGrpc(
                        result.vote_session,
                    );

                    // Emit active-vote event to the requesting client
                    this.eventService.emitToClient(
                        client,
                        'sfu:active-vote',
                        voteSession,
                    );

                    console.log(
                        '[VotingHandler] Active vote sent for room:',
                        data.roomId,
                    );
                    return { success: true, voteSession };
                } else {
                    // No active vote
                    this.eventService.emitToClient(
                        client,
                        'sfu:active-vote',
                        null,
                    );
                    console.log(
                        '[VotingHandler] No active vote in room:',
                        data.roomId,
                    );
                    return { success: true, voteSession: null };
                }
            } else {
                const errorMsg = result?.error || 'Failed to get active vote';
                console.error(
                    '[VotingHandler] Failed to get active vote:',
                    errorMsg,
                );
                this.eventService.emitToClient(client, 'sfu:vote-error', {
                    message: errorMsg,
                    code: 'GET_ACTIVE_VOTE_FAILED',
                });
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error('[VotingHandler] Error getting active vote:', error);
            this.eventService.emitToClient(client, 'sfu:vote-error', {
                message: 'Internal server error',
                code: 'GET_ACTIVE_VOTE_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Transform vote session data from gRPC format to frontend format
     * Handles both snake_case (backend) and camelCase (frontend) field names
     */
    private transformVoteSessionFromGrpc(voteSession: VoteSessionGrpc): any {
        if (!voteSession) return null;

        return {
            id: voteSession.id,
            creatorId: voteSession.creator_id,
            creator_id: voteSession.creator_id, // Keep both for compatibility
            question: voteSession.question,
            options: voteSession.options || [],
            participants: voteSession.voters || [], // For backward compatibility
            voters: voteSession.voters || [], // New field from backend
            isActive: voteSession.is_active,
            createdAt: voteSession.created_at,
            endedAt: voteSession.ended_at,
        };
    }
}
