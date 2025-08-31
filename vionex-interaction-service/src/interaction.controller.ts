import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { InteractionService } from './interaction.service';
import { WhiteboardService } from './services/whiteboard.service';
import { VotingService } from './services/voting.service';
import { QuizService } from './services/quiz.service';
import { BehaviorService } from './services/behavior.service';

@Controller()
export class InteractionController {
    constructor(
        private readonly interactionService: InteractionService,
        private readonly whiteboardService: WhiteboardService,
        private readonly votingService: VotingService,
        private readonly quizService: QuizService,
        private readonly behaviorService: BehaviorService,
    ) {}

    // ===================== WHITEBOARD METHODS =====================
    @GrpcMethod('WhiteboardService', 'UpdateWhiteboard')
    async updateWhiteboard(data: {
        room_id: string;
        elements: any[];
        state: string;
    }) {
        try {
            // Convert gRPC proto elements back to full structure
            const fullElements =
                data.elements?.map((element) => {
                    try {
                        // Parse the data field back to object
                        const parsedData = element.data
                            ? JSON.parse(element.data)
                            : {};

                        // Reconstruct the full element structure
                        const fullElement = {
                            id: element.id,
                            type: element.type,
                            x: element.x,
                            y: element.y,
                            ...parsedData, // Spread all other properties from data field
                        };

                        return fullElement;
                    } catch (parseError) {
                        // Return basic structure if parsing fails
                        return {
                            id: element.id,
                            type: element.type,
                            x: element.x,
                            y: element.y,
                        };
                    }
                }) || [];

            const result = this.whiteboardService.updateWhiteboardData(
                data.room_id,
                fullElements, // Use deserialized elements
                JSON.parse(data.state || '{}'),
            );

            return {
                success: true,
                whiteboard_data: {
                    room_id: data.room_id,
                    elements: result.elements,
                    state: JSON.stringify(result.state),
                    allowed_users:
                        this.whiteboardService.getPermissions(data.room_id)
                            .allowed_users || [],
                    updated_at: result.updatedAt,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
            };
        }
    }

    @GrpcMethod('WhiteboardService', 'GetWhiteboardData')
    async getWhiteboardData(data: { room_id: string }) {
        try {
            const whiteboardData = this.whiteboardService.getWhiteboardData(
                data.room_id,
            );

            const permissions = this.whiteboardService.getPermissions(
                data.room_id,
            );

            // Convert elements to gRPC proto structure
            let serializedElements: any[] = [];
            if (
                whiteboardData?.elements &&
                Array.isArray(whiteboardData.elements)
            ) {
                serializedElements = whiteboardData.elements.map((element) => {
                    const { id, type, x, y, ...otherProps } = element;

                    // Serialize all other properties into data field as JSON
                    const protoElement = {
                        id: id || '',
                        type: type || '',
                        x: x || 0,
                        y: y || 0,
                        data: JSON.stringify(otherProps), // All other props go into data as JSON
                    };

                    return protoElement;
                });
            }

            const response = {
                success: true,
                whiteboard_data: whiteboardData
                    ? {
                          room_id: data.room_id,
                          elements: serializedElements,
                          state: JSON.stringify(whiteboardData.state || {}),
                          allowed_users: permissions.allowed_users || [],
                          updated_at:
                              whiteboardData.timestamp ||
                              new Date().toISOString(),
                      }
                    : {
                          room_id: data.room_id,
                          elements: [],
                          state: '{}',
                          allowed_users: permissions.allowed_users || [],
                          updated_at: new Date().toISOString(),
                      },
            };

            return response;
        } catch (error) {
            return {
                success: false,
                whiteboard_data: {
                    room_id: data.room_id,
                    elements: [],
                    state: '{}',
                    allowed_users: [],
                    updated_at: new Date().toISOString(),
                },
            };
        }
    }

    @GrpcMethod('WhiteboardService', 'ClearWhiteboard')
    async clearWhiteboard(data: { room_id: string }) {
        try {
            this.whiteboardService.clearWhiteboard(data.room_id);
            return { success: true };
        } catch (error) {
            return { success: false };
        }
    }

    @GrpcMethod('WhiteboardService', 'UpdatePermissions')
    async updatePermissions(data: {
        room_id: string;
        allowed_users: string[];
    }) {
        try {
            const result = this.whiteboardService.updatePermissions(
                data.room_id,
                data.allowed_users,
            );

            return {
                success: result.success,
                allowed_users: result.allowed_users,
            };
        } catch (error) {
            console.error(
                '[InteractionController] UpdatePermissions error:',
                error,
            );
            return {
                success: false,
                allowed_users: [],
            };
        }
    }

    @GrpcMethod('WhiteboardService', 'GetPermissions')
    async getPermissions(data: { room_id: string }) {
        try {
            const result = this.whiteboardService.getPermissions(data.room_id);
            return {
                success: result.success,
                allowed_users: result.allowed_users,
            };
        } catch (error) {
            console.error(
                '[InteractionController] GetPermissions error:',
                error,
            );
            return {
                success: false,
                allowed_users: [],
            };
        }
    }

    @GrpcMethod('WhiteboardService', 'CheckUserPermission')
    async checkUserPermission(data: { room_id: string; peer_id: string }) {
        try {
            const canDraw = await this.whiteboardService.canUserDraw(
                data.room_id,
                data.peer_id,
            );

            const result = {
                success: true,
                can_draw: canDraw,
            };

            return result;
        } catch (error) {
            console.error('[Interaction] CheckUserPermission error:', error);
            return {
                success: false,
                can_draw: false,
            };
        }
    }

    @GrpcMethod('WhiteboardService', 'InitializeRoomPermissions')
    async initializeRoomPermissions(data: {
        room_id: string;
        creator_peer_id: string;
    }) {
        try {
            this.whiteboardService.initializeRoomPermissions(
                data.room_id,
                data.creator_peer_id,
            );
            return {
                success: true,
            };
        } catch (error) {
            return {
                success: false,
            };
        }
    }

    @GrpcMethod('WhiteboardService', 'UpdateUserPointer')
    async updateUserPointer(data: {
        room_id: string;
        peer_id: string;
        position: { x: number; y: number; tool: string };
    }) {
        try {
            const pointers = this.whiteboardService.updateUserPointer(
                data.room_id,
                data.peer_id,
                data.position,
            );
            return {
                success: true,
                pointers: pointers.map((p) => ({
                    position: p.position,
                    peer_id: p.peerId,
                })),
            };
        } catch (error) {
            return {
                success: false,
                pointers: [],
            };
        }
    }

    @GrpcMethod('WhiteboardService', 'GetPointers')
    async getPointers(data: { room_id: string }) {
        try {
            const pointers = this.whiteboardService.getPointers(data.room_id);
            return {
                success: true,
                pointers: pointers.map((p) => ({
                    position: p.position,
                    peer_id: p.peerId,
                })),
            };
        } catch (error) {
            return {
                success: false,
                pointers: [],
            };
        }
    }

    @GrpcMethod('WhiteboardService', 'RemoveUserPointer')
    async removeUserPointer(data: { room_id: string; peer_id: string }) {
        try {
            const pointers = this.whiteboardService.removeUserPointer(
                data.room_id,
                data.peer_id,
            );
            return {
                success: true,
                pointers: pointers.map((p) => ({
                    position: p.position,
                    peer_id: p.peerId,
                })),
            };
        } catch (error) {
            return {
                success: false,
                pointers: [],
            };
        }
    }

    // ===================== VOTING METHODS =====================
    @GrpcMethod('VotingService', 'CreateVote')
    async createVote(data: {
        room_id: string;
        question: string;
        options: { id: string; text: string }[];
        creator_id: string;
    }) {
        try {
            const voteSession = this.votingService.createVote(
                data.room_id,
                data.question,
                data.options,
                data.creator_id,
            );
            const result = {
                success: true,
                vote_session: this.transformVoteSessionToGrpc(voteSession),
            };

            return result;
        } catch (error) {
            console.error('[InteractionController] Error creating vote:', {
                error: error.message,
                stack: error.stack,
                data,
            });
            return {
                success: false,
                error: error.message,
            };
        }
    }

    @GrpcMethod('VotingService', 'SubmitVote')
    async submitVote(data: {
        room_id: string;
        vote_id: string;
        option_id: string;
        voter_id: string;
    }) {
        try {
            const voteSession = this.votingService.submitVote(
                data.room_id,
                data.vote_id,
                data.option_id,
                data.voter_id,
            );

            if (!voteSession) {
                return {
                    success: false,
                    error: 'Invalid vote or user already voted',
                };
            }

            const result = {
                success: true,
                vote_session: this.transformVoteSessionToGrpc(voteSession),
            };

            return result;
        } catch (error) {
            console.error('[InteractionController] Error submitting vote:', {
                error: error.message,
                stack: error.stack,
                data,
            });
            return {
                success: false,
                error: error.message,
            };
        }
    }

    @GrpcMethod('VotingService', 'GetVoteResults')
    async getVoteResults(data: { room_id: string; vote_id: string }) {
        try {
            const voteSession = this.votingService.getVoteResults(
                data.room_id,
                data.vote_id,
            );

            if (!voteSession) {
                return {
                    success: false,
                    error: 'Vote not found',
                };
            }

            const result = {
                success: true,
                vote_session: this.transformVoteSessionToGrpc(voteSession),
            };

            return result;
        } catch (error) {
            console.error(
                '[InteractionController] Error getting vote results:',
                {
                    error: error.message,
                    stack: error.stack,
                    data,
                },
            );
            return {
                success: false,
                error: error.message,
            };
        }
    }

    @GrpcMethod('VotingService', 'EndVote')
    async endVote(data: {
        room_id: string;
        vote_id: string;
        creator_id: string;
    }) {
        try {
            const voteSession = this.votingService.endVote(
                data.room_id,
                data.vote_id,
                data.creator_id,
            );

            if (!voteSession) {
                return {
                    success: false,
                    error: 'Vote not found or unauthorized',
                };
            }
            const result = {
                success: true,
                vote_session: this.transformVoteSessionToGrpc(voteSession),
            };
            return result;
        } catch (error) {
            console.error('[InteractionController] Error ending vote:', {
                error: error.message,
                stack: error.stack,
                data,
            });
            return {
                success: false,
                error: error.message,
            };
        }
    }

    @GrpcMethod('VotingService', 'GetActiveVote')
    async getActiveVote(data: { room_id: string }) {
        try {
            const voteSession = this.votingService.getActiveVote(data.room_id);

            const result = {
                success: true,
                vote_session: voteSession
                    ? this.transformVoteSessionToGrpc(voteSession)
                    : null,
            };
            return result;
        } catch (error) {
            console.error(
                '[InteractionController] Error getting active vote:',
                {
                    error: error.message,
                    stack: error.stack,
                    data,
                },
            );
            return {
                success: false,
                error: error.message,
            };
        }
    }

    // ===================== QUIZ METHODS =====================
    @GrpcMethod('QuizService', 'CreateQuiz')
    async createQuiz(data: {
        room_id: string;
        title: string;
        questions: any[];
        creator_id: string;
    }) {
        try {
            // Transform questions from gRPC format to internal format
            const questions = data.questions.map((question: any) => ({
                id: question.id,
                text: question.text,
                type: question.type,
                options:
                    question.options?.map((option: any) => ({
                        id: option.id,
                        text: option.text,
                        isCorrect: option.is_correct,
                    })) || [],
                correctAnswers: question.correct_answers || [],
                answer: question.answer || '',
                points: 1, // Default points
            }));

            const quizSession = this.quizService.createQuiz(
                data.room_id,
                data.title,
                questions,
                data.creator_id,
            );

            return {
                success: true,
                quiz_session: this.transformQuizSessionToGrpc(quizSession), // No answers for anyone
            };
        } catch (error) {
            console.error(
                '[InteractionController] Error creating quiz:',
                error,
            );
            return {
                success: false,
                error: error.message,
            };
        }
    }

    @GrpcMethod('QuizService', 'SubmitQuiz')
    async submitQuiz(data: {
        room_id: string;
        quiz_id: string;
        participant_id: string;
        answers: Array<{
            question_id: string;
            selected_options: string[];
            essay_answer: string;
        }>;
    }) {
        try {
            // Transform answers to internal format
            const answers = data.answers.map((answer) => ({
                questionId: answer.question_id,
                selectedOptions: answer.selected_options || [],
                essayAnswer: answer.essay_answer || '',
            }));

            const result = this.quizService.submitQuiz(
                data.room_id,
                data.quiz_id,
                data.participant_id,
                answers,
            );
            return {
                success: result.success,
                total_score: result.totalScore,
                total_possible_score: result.totalPossibleScore,
                question_results: result.questionResults.map((qr) => ({
                    question_id: qr.questionId,
                    is_correct: qr.isCorrect,
                    points_earned: qr.pointsEarned,
                    correct_answers: qr.correctAnswers,
                })),
                error: result.success ? undefined : 'Failed to submit quiz',
            };
        } catch (error) {
            console.error(
                '[InteractionController] Error submitting quiz:',
                error,
            );
            return {
                success: false,
                total_score: 0,
                total_possible_score: 0,
                question_results: [],
                error: error.message,
            };
        }
    }

    @GrpcMethod('QuizService', 'GetQuizResults')
    async getQuizResults(data: { room_id: string; quiz_id: string }) {
        try {
            const quizSession = this.quizService.getQuizResults(
                data.room_id,
                data.quiz_id,
            );

            if (!quizSession) {
                return {
                    success: false,
                };
            }
            return {
                success: true,
                quiz_session: this.transformQuizSessionToGrpc(quizSession),
            };
        } catch (error) {
            console.error(
                '[InteractionController] Error getting quiz results:',
                error,
            );
            return {
                success: false,
            };
        }
    }

    @GrpcMethod('QuizService', 'EndQuiz')
    async endQuiz(data: {
        room_id: string;
        quiz_id: string;
        creator_id: string;
    }) {
        try {
            const quizSession = this.quizService.endQuiz(
                data.room_id,
                data.quiz_id,
                data.creator_id,
            );

            if (!quizSession) {
                return {
                    success: false,
                };
            }

            return {
                success: true,
                quiz_session: this.transformQuizSessionToGrpc(quizSession),
            };
        } catch (error) {
            console.error('[InteractionController] Error ending quiz:', error);
            return {
                success: false,
            };
        }
    }

    @GrpcMethod('QuizService', 'GetActiveQuiz')
    async getActiveQuiz(data: { room_id: string }) {
        try {
            const activeQuiz = this.quizService.getActiveQuiz(data.room_id);

            if (!activeQuiz) {
                return {
                    success: true,
                    quiz_session: null,
                };
            }
            return {
                success: true,
                quiz_session: this.transformQuizSessionToGrpc(activeQuiz), // No answers for security
            };
        } catch (error) {
            console.error(
                '[InteractionController] Error getting active quiz:',
                error,
            );
            return {
                success: false,
                quiz_session: null,
            };
        }
    }

    // ===================== BEHAVIOR MONITORING METHODS =====================
    @GrpcMethod('BehaviorService', 'SaveUserBehavior')
    async saveUserBehavior(data: {
        user_id: string;
        room_id: string;
        events: Array<{ type: string; value: string; time: string }>;
    }) {
        try {
            const events = data.events.map((event) => ({
                type: event.type,
                value: this.parseEventValue(event.value),
                time: new Date(event.time),
            }));

            const success = this.behaviorService.saveUserBehavior(
                data.user_id,
                data.room_id,
                events,
            );

            return {
                success,
                error: success ? null : 'Failed to save user behavior',
            };
        } catch (error) {
            console.error(
                '[InteractionController] SaveUserBehavior error:',
                error,
            );
            return {
                success: false,
                error: error.message,
            };
        }
    }

    @GrpcMethod('BehaviorService', 'SetBehaviorMonitorState')
    async setBehaviorMonitorState(data: {
        room_id: string;
        is_active: boolean;
    }) {
        try {
            this.behaviorService.setBehaviorMonitorState(
                data.room_id,
                data.is_active,
            );
            return { success: true };
        } catch (error) {
            console.error(
                '[InteractionController] SetBehaviorMonitorState error:',
                error,
            );
            return { success: false };
        }
    }

    @GrpcMethod('BehaviorService', 'GetBehaviorMonitorState')
    async getBehaviorMonitorState(data: { room_id: string }) {
        try {
            const isActive = this.behaviorService.getBehaviorMonitorState(
                data.room_id,
            );
            return { is_active: isActive };
        } catch (error) {
            console.error(
                '[InteractionController] GetBehaviorMonitorState error:',
                error,
            );
            return { is_active: false };
        }
    }

    @GrpcMethod('BehaviorService', 'GenerateUserLogExcel')
    async generateUserLogExcel(data: { room_id: string; user_id: string }) {
        try {
            const excelBuffer = await this.behaviorService.generateUserLogExcel(
                data.room_id,
                data.user_id,
            );

            return {
                success: true,
                excel_data: excelBuffer,
                error: null,
            };
        } catch (error) {
            console.error(
                '[InteractionController] GenerateUserLogExcel error:',
                error,
            );
            return {
                success: false,
                excel_data: Buffer.alloc(0),
                error: error.message,
            };
        }
    }

    @GrpcMethod('BehaviorService', 'GenerateRoomLogExcel')
    async generateRoomLogExcel(data: { room_id: string }) {
        try {
            const excelBuffer = await this.behaviorService.generateRoomLogExcel(
                data.room_id,
            );

            return {
                success: true,
                excel_data: excelBuffer,
                error: null,
            };
        } catch (error) {
            console.error(
                '[InteractionController] GenerateRoomLogExcel error:',
                error,
            );
            return {
                success: false,
                excel_data: Buffer.alloc(0),
                error: error.message,
            };
        }
    }

    @GrpcMethod('BehaviorService', 'ClearRoomLogs')
    async clearRoomLogs(data: { room_id: string }) {
        try {
            this.behaviorService.clearRoomLogs(data.room_id);
            return { success: true };
        } catch (error) {
            console.error(
                '[InteractionController] ClearRoomLogs error:',
                error,
            );
            return { success: false };
        }
    }

    private parseEventValue(value: string): boolean | string | number {
        // Try to parse as boolean
        if (value === 'true') return true;
        if (value === 'false') return false;

        // Try to parse as number
        const numValue = Number(value);
        if (!isNaN(numValue)) return numValue;

        // Return as string
        return value;
    }

    // Helper methods for data transformation
    private transformVoteSessionToGrpc(voteSession: any) {
        return {
            id: voteSession.id,
            room_id: voteSession.roomId,
            question: voteSession.question,
            options: voteSession.options,
            creator_id: voteSession.creatorId,
            is_active: voteSession.isActive,
            created_at: voteSession.createdAt,
            ended_at: voteSession.endedAt,
            voters: voteSession.voters,
        };
    }

    private transformQuizSessionToGrpc(quizSession: any) {
        const participantScores: { [key: string]: number } = {};
        quizSession.participantScores.forEach(
            (score: number, participantId: string) => {
                participantScores[participantId] = score;
            },
        );

        // NEVER send correct answers to client for security reasons
        const questions = quizSession.questions.map((question: any) => ({
            id: question.id,
            text: question.text,
            type: question.type,
            options:
                question.options?.map((option: any) => ({
                    id: option.id,
                    text: option.text,
                    is_correct: false,
                })) || [],
            correct_answers: [],
            answer: question.answer || '',
        }));
        return {
            id: quizSession.id,
            room_id: quizSession.roomId,
            title: quizSession.title,
            questions: questions,
            creator_id: quizSession.creatorId,
            is_active: quizSession.isActive,
            created_at: quizSession.createdAt,
            ended_at: quizSession.endedAt,
            participant_scores: participantScores,
        };
    }
}
