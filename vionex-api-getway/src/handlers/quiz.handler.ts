import { Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { InteractionClientService } from '../clients/interaction.client';
import { WebSocketEventService } from '../services/websocket-event.service';

// Define interfaces for quiz responses
export interface QuizOption {
    id: string;
    text: string;
    isCorrect: boolean;
}

export interface QuizQuestion {
    id: string;
    text: string;
    type: 'multiple-choice' | 'essay' | 'one-choice';
    options?: QuizOption[];
    correctAnswers?: string[];
    answer?: string;
    points?: number;
}

export interface QuizSessionGrpc {
    id: string;
    room_id: string;
    title: string;
    questions: QuizQuestion[];
    creator_id: string;
    is_active: boolean;
    created_at: string;
    ended_at?: string;
    participant_scores: { [key: string]: number };
    current_question_index: number;
}

export interface QuizAnswer {
    questionId: string;
    selectedOptions: string[];
    essayAnswer: string;
}

export interface QuizSubmissionResult {
    success: boolean;
    totalScore: number;
    totalPossibleScore: number;
    questionResults: Array<{
        questionId: string;
        isCorrect: boolean;
        pointsEarned: number;
        correctAnswers: string[];
    }>;
}

export interface QuizResponse {
    success: boolean;
    quiz_session?: QuizSessionGrpc;
    submission_result?: QuizSubmissionResult;
    // Direct fields for submission response
    total_score?: number;
    total_possible_score?: number;
    question_results?: Array<{
        question_id: string;
        is_correct: boolean;
        points_earned: number;
        correct_answers: string[];
    }>;
    error?: string;
}

@Injectable()
export class QuizHandler {
    constructor(
        private readonly interactionClient: InteractionClientService,
        private readonly eventService: WebSocketEventService,
    ) {
        console.log('[QuizHandler] QuizHandler initialized as service');
    }

    /**
     * Create a new quiz session
     */
    async handleCreateQuiz(
        client: Socket,
        data: {
            roomId: string;
            title: string;
            questions: QuizQuestion[];
            creatorId: string;
        },
    ) {
        try {
            console.log('[QuizHandler] Creating quiz:', data);

            // Validate input
            if (
                !data.roomId ||
                !data.title ||
                !data.questions ||
                data.questions.length === 0 ||
                !data.creatorId
            ) {
                const errorMsg =
                    'Invalid quiz data: roomId, title, questions, and creatorId are required';
                console.error('[QuizHandler]', errorMsg);
                this.eventService.emitToClient(client, 'quiz:error', {
                    message: errorMsg,
                    code: 'INVALID_QUIZ_DATA',
                });
                return { success: false, error: errorMsg };
            }

            // Call interaction service to create quiz
            const result = (await this.interactionClient.createQuiz(
                data.roomId,
                data.title,
                data.questions,
                data.creatorId,
            )) as QuizResponse;

            if (result && result.success && result.quiz_session) {
                // Transform quiz session data for frontend
                const quizSession = this.transformQuizSessionFromGrpc(
                    result.quiz_session,
                );

                // Emit quiz-created event to the creator first
                this.eventService.emitToClient(
                    client,
                    'quiz:created',
                    quizSession,
                );

                // Then broadcast to all other clients in room
                // client.to(data.roomId).emit('quiz:created', quizSession);
                this.eventService.broadcastToRoom(client, data.roomId, 'quiz:created', quizSession);

                console.log(
                    '[QuizHandler] Quiz created successfully:',
                    quizSession.id,
                );
                return { success: true, quizSession };
            } else {
                const errorMsg = result?.error || 'Failed to create quiz';
                console.error('[QuizHandler] Failed to create quiz:', errorMsg);
                this.eventService.emitToClient(client, 'quiz:error', {
                    message: errorMsg,
                    code: 'CREATE_QUIZ_FAILED',
                });
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error('[QuizHandler] Error creating quiz:', error);
            this.eventService.emitToClient(client, 'quiz:error', {
                message: 'Internal server error',
                code: 'CREATE_QUIZ_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Submit a quiz
     */
    async handleSubmitQuiz(
        client: Socket,
        data: {
            roomId: string;
            quizId: string;
            participantId: string;
            answers: QuizAnswer[];
        },
    ) {
        try {
            console.log('[QuizHandler] Submitting quiz:', data);

            // Validate input
            if (
                !data.roomId ||
                !data.quizId ||
                !data.participantId ||
                !data.answers
            ) {
                const errorMsg =
                    'Invalid quiz submission data: roomId, quizId, participantId, and answers are required';
                console.error('[QuizHandler]', errorMsg);
                this.eventService.emitToClient(client, 'quiz:error', {
                    message: errorMsg,
                    code: 'INVALID_QUIZ_SUBMISSION',
                });
                return { success: false, error: errorMsg };
            }

            // Call interaction service to submit quiz
            console.log('[QuizHandler] Calling interaction service with:', {
                roomId: data.roomId,
                quizId: data.quizId,
                participantId: data.participantId,
                answersCount: data.answers.length,
            });
            const result = (await this.interactionClient.submitQuiz(
                data.roomId,
                data.quizId,
                data.participantId,
                data.answers,
            )) as QuizResponse;

            console.log('[QuizHandler] Submit quiz result:', result);

            if (
                result &&
                result.success &&
                (result.submission_result || result.total_score !== undefined)
            ) {
                // Handle both formats: with submission_result or direct fields
                const totalScore =
                    result.submission_result?.totalScore || result.total_score;
                const totalPossibleScore =
                    result.submission_result?.totalPossibleScore ||
                    result.total_possible_score;
                const questionResults =
                    result.submission_result?.questionResults ||
                    result.question_results;

                // Emit quiz-result event to the submitting client
                this.eventService.emitToClient(client, 'quiz:result', {
                    participantId: data.participantId,
                    quizId: data.quizId,
                    totalScore: totalScore,
                    totalPossibleScore: totalPossibleScore,
                    questionResults: questionResults,
                });

                // Emit quiz-submission event to all other clients in room (for creator to see)
                client.to(data.roomId).emit('quiz:submission', {
                    participantId: data.participantId,
                    quizId: data.quizId,
                    results: {
                        score: totalScore,
                        totalPossibleScore: totalPossibleScore,
                        startedAt: new Date().toISOString(),
                        finishedAt: new Date().toISOString(),
                    },
                });

                console.log(
                    '[QuizHandler] Quiz submitted successfully by:',
                    data.participantId,
                );
                return {
                    success: true,
                    submissionResult: {
                        success: true,
                        totalScore: totalScore,
                        totalPossibleScore: totalPossibleScore,
                        questionResults: questionResults,
                    },
                };
            } else {
                const errorMsg = result?.error || 'Failed to submit quiz';
                console.error('[QuizHandler] Failed to submit quiz:', errorMsg);
                this.eventService.emitToClient(client, 'quiz:error', {
                    message: errorMsg,
                    code: 'SUBMIT_QUIZ_FAILED',
                });
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error('[QuizHandler] Error submitting quiz:', error);
            this.eventService.emitToClient(client, 'quiz:error', {
                message: 'Internal server error',
                code: 'SUBMIT_QUIZ_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * End a quiz session
     */
    async handleEndQuiz(
        client: Socket,
        data: {
            roomId: string;
            quizId: string;
            creatorId: string;
        },
    ) {
        try {
            console.log('[QuizHandler] Ending quiz:', data);

            // Validate input
            if (!data.roomId || !data.quizId || !data.creatorId) {
                const errorMsg =
                    'Invalid request: roomId, quizId, and creatorId are required';
                console.error('[QuizHandler]', errorMsg);
                this.eventService.emitToClient(client, 'quiz:error', {
                    message: errorMsg,
                    code: 'INVALID_END_QUIZ_REQUEST',
                });
                return { success: false, error: errorMsg };
            }

            // Call interaction service to end quiz
            const result = (await this.interactionClient.endQuiz(
                data.roomId,
                data.quizId,
                data.creatorId,
            )) as QuizResponse;

            if (result && result.success && result.quiz_session) {
                // Transform quiz session data for frontend
                const quizSession = this.transformQuizSessionFromGrpc(
                    result.quiz_session,
                );

                // Emit quiz-ended event to creator first
                this.eventService.emitToClient(client, 'quiz:ended', {
                    quiz_session: quizSession,
                });

                // Then broadcast to all other clients in room
                client.to(data.roomId).emit('quiz:ended', {
                    quiz_session: quizSession,
                });

                console.log(
                    '[QuizHandler] Quiz ended successfully:',
                    data.quizId,
                );
                return { success: true, quizSession };
            } else {
                const errorMsg = result?.error || 'Failed to end quiz';
                console.error('[QuizHandler] Failed to end quiz:', errorMsg);
                this.eventService.emitToClient(client, 'quiz:error', {
                    message: errorMsg,
                    code: 'END_QUIZ_FAILED',
                });
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error('[QuizHandler] Error ending quiz:', error);
            this.eventService.emitToClient(client, 'quiz:error', {
                message: 'Internal server error',
                code: 'END_QUIZ_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get active quiz session
     */
    async handleGetActiveQuiz(
        client: Socket,
        data: {
            roomId: string;
            requesterId: string;
        },
    ) {
        try {
            console.log('[QuizHandler] Getting active quiz:', data);

            // Validate input
            if (!data.roomId) {
                const errorMsg = 'Invalid request: roomId is required';
                console.error('[QuizHandler]', errorMsg);
                this.eventService.emitToClient(client, 'quiz:error', {
                    message: errorMsg,
                    code: 'INVALID_GET_ACTIVE_QUIZ_REQUEST',
                });
                return { success: false, error: errorMsg };
            }

            // Call interaction service to get active quiz
            const result = (await this.interactionClient.getActiveQuiz(
                data.roomId,
            )) as QuizResponse;

            if (result && result.success) {
                if (result.quiz_session) {
                    // Transform quiz session data for frontend
                    const quizSession = this.transformQuizSessionFromGrpc(
                        result.quiz_session,
                    );

                    // Emit active quiz event to the requesting client
                    this.eventService.emitToClient(client, 'quiz:active', {
                        quiz_session: quizSession,
                    });

                    console.log(
                        '[QuizHandler] Active quiz sent for room:',
                        data.roomId,
                    );
                    return { success: true, quizSession };
                } else {
                    // No active quiz
                    this.eventService.emitToClient(client, 'quiz:active', null);
                    console.log(
                        '[QuizHandler] No active quiz in room:',
                        data.roomId,
                    );
                    return { success: true, quizSession: null };
                }
            } else {
                const errorMsg = result?.error || 'Failed to get active quiz';
                console.error(
                    '[QuizHandler] Failed to get active quiz:',
                    errorMsg,
                );
                this.eventService.emitToClient(client, 'quiz:error', {
                    message: errorMsg,
                    code: 'GET_ACTIVE_QUIZ_FAILED',
                });
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error('[QuizHandler] Error getting active quiz:', error);
            this.eventService.emitToClient(client, 'quiz:error', {
                message: 'Internal server error',
                code: 'GET_ACTIVE_QUIZ_ERROR',
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Transform quiz session data from gRPC format to frontend format
     * Handles both snake_case (backend) and camelCase (frontend) field names
     */
    private transformQuizSessionFromGrpc(quizSession: QuizSessionGrpc): any {
        if (!quizSession) return null;

        return {
            id: quizSession.id,
            roomId: quizSession.room_id,
            title: quizSession.title,
            questions: quizSession.questions || [],
            creatorId: quizSession.creator_id,
            creator_id: quizSession.creator_id, // Keep both for compatibility
            isActive: quizSession.is_active,
            createdAt: quizSession.created_at,
            endedAt: quizSession.ended_at,
            participantScores: quizSession.participant_scores || {},
            currentQuestionIndex: quizSession.current_question_index || 0,
        };
    }
}
