import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

// Whiteboard interfaces
interface WhiteboardServiceClient {
    updateWhiteboard(data: {
        room_id: string;
        elements: any[];
        state: string;
    }): any;

    getWhiteboardData(data: { room_id: string }): any;

    clearWhiteboard(data: { room_id: string }): any;

    updatePermissions(data: { room_id: string; allowed_users: string[] }): any;

    getPermissions(data: { room_id: string }): any;

    checkUserPermission(data: { room_id: string; peer_id: string }): any;

    initializeRoomPermissions(data: {
        room_id: string;
        creator_peer_id: string;
    }): any;

    updateUserPointer(data: {
        room_id: string;
        peer_id: string;
        position: { x: number; y: number; tool: string };
    }): any;

    getPointers(data: { room_id: string }): any;

    removeUserPointer(data: { room_id: string; peer_id: string }): any;
}

// Voting interfaces
interface VotingServiceClient {
    createVote(data: {
        room_id: string;
        question: string;
        options: { id: string; text: string }[];
        creator_id: string;
    }): any;

    submitVote(data: {
        room_id: string;
        vote_id: string;
        option_id: string;
        voter_id: string;
    }): any;

    getVoteResults(data: { room_id: string; vote_id: string }): any;

    endVote(data: {
        room_id: string;
        vote_id: string;
        creator_id: string;
    }): any;

    getActiveVote(data: { room_id: string }): any;
}

// Quiz interfaces
interface QuizServiceClient {
    createQuiz(data: {
        room_id: string;
        title: string;
        questions: any[];
        creator_id: string;
    }): any;

    submitQuiz(data: {
        room_id: string;
        quiz_id: string;
        participant_id: string;
        answers: Array<{
            question_id: string;
            selected_options: string[];
            essay_answer: string;
        }>;
    }): any;

    getQuizResults(data: { room_id: string; quiz_id: string }): any;

    endQuiz(data: {
        room_id: string;
        quiz_id: string;
        creator_id: string;
    }): any;

    getActiveQuiz(data: { room_id: string }): any;
}

// Behavior monitoring interfaces
interface BehaviorServiceClient {
    saveUserBehavior(data: {
        user_id: string;
        room_id: string;
        events: Array<{ type: string; value: string; time: string }>;
    }): any;

    setBehaviorMonitorState(data: { room_id: string; is_active: boolean }): any;

    getBehaviorMonitorState(data: { room_id: string }): any;

    generateUserLogExcel(data: { room_id: string; user_id: string }): any;

    generateRoomLogExcel(data: { room_id: string }): any;

    clearRoomLogs(data: { room_id: string }): any;
}

@Injectable()
export class InteractionClientService implements OnModuleInit {
    private whiteboardService: WhiteboardServiceClient;
    private votingService: VotingServiceClient;
    private quizService: QuizServiceClient;
    private behaviorService: BehaviorServiceClient;

    constructor(@Inject('INTERACTION_SERVICE') private client: ClientGrpc) {}

    onModuleInit() {
        this.whiteboardService =
            this.client.getService<WhiteboardServiceClient>(
                'WhiteboardService',
            );
        this.votingService =
            this.client.getService<VotingServiceClient>('VotingService');
        this.quizService =
            this.client.getService<QuizServiceClient>('QuizService');
        this.behaviorService =
            this.client.getService<BehaviorServiceClient>('BehaviorService');
    }

    // Whiteboard methods
    async updateWhiteboard(roomId: string, elements: any[], state: string) {
        try {
            console.log('[InteractionClient] updateWhiteboard called with:', {
                roomId,
                elementsCount: elements?.length,
                sampleElement: elements?.[0],
                stateLength: state?.length,
            });

            // Convert elements to match gRPC proto structure
            const serializedElements =
                elements?.map((element) => {
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
                }) || [];

            console.log('[InteractionClient] Serialized elements:', {
                count: serializedElements.length,
                sample: serializedElements[0],
            });

            const observable = this.whiteboardService.updateWhiteboard({
                room_id: roomId,
                elements: serializedElements,
                state,
            });

            const result = await firstValueFrom(observable);
            console.log('[InteractionClient] updateWhiteboard result:', result);
            return result;
        } catch (error) {
            console.error('[InteractionClient] updateWhiteboard error:', error);
            throw error;
        }
    }

    async getWhiteboardData(roomId: string) {
        try {
            console.log(
                '[InteractionClient] getWhiteboardData called for room:',
                roomId,
            );

            const observable = this.whiteboardService.getWhiteboardData({
                room_id: roomId,
            });
            const result: any = await firstValueFrom(observable);

            console.log(
                '[InteractionClient] getWhiteboardData raw result:',
                result,
            );

            // Deserialize elements from gRPC proto structure back to full structure
            if (result?.success && result?.whiteboard_data?.elements) {
                const deserializedElements =
                    result.whiteboard_data.elements.map((element) => {
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
                            console.error(
                                '[InteractionClient] Error parsing element data:',
                                {
                                    elementId: element.id,
                                    elementType: element.type,
                                    dataLength: element.data?.length || 0,
                                    parseError: parseError.message,
                                },
                            );

                            // Return basic structure if parsing fails
                            return {
                                id: element.id,
                                type: element.type,
                                x: element.x,
                                y: element.y,
                            };
                        }
                    });

                // Replace elements with deserialized version
                result.whiteboard_data.elements = deserializedElements;
            }

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] getWhiteboardData error:',
                error,
            );
            throw error;
        }
    }

    async clearWhiteboard(roomId: string) {
        const observable = this.whiteboardService.clearWhiteboard({
            room_id: roomId,
        });
        return await firstValueFrom(observable);
    }

    async updatePermissions(roomId: string, allowedUsers: string[]) {
        const observable = this.whiteboardService.updatePermissions({
            room_id: roomId,
            allowed_users: allowedUsers,
        });
        return await firstValueFrom(observable);
    }

    async getPermissions(roomId: string) {
        const observable = this.whiteboardService.getPermissions({
            room_id: roomId,
        });
        return await firstValueFrom(observable);
    }

    async checkUserPermission(
        roomId: string,
        peerId: string,
    ): Promise<{ success: boolean; can_draw: boolean }> {
        try {
            const observable = this.whiteboardService.checkUserPermission({
                room_id: roomId,
                peer_id: peerId,
            });

            // Add timeout to prevent hanging
            const result = (await Promise.race([
                firstValueFrom(observable),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error('gRPC call timeout')),
                        5000,
                    ),
                ),
            ])) as { success: boolean; can_draw: boolean };

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] checkUserPermission error:',
                error,
            );
            return {
                success: false,
                can_draw: false,
            };
        }
    }

    async initializeRoomPermissions(roomId: string, creatorPeerId: string) {
        const observable = this.whiteboardService.initializeRoomPermissions({
            room_id: roomId,
            creator_peer_id: creatorPeerId,
        });
        return await firstValueFrom(observable);
    }

    async updateUserPointer(
        roomId: string,
        peerId: string,
        position: { x: number; y: number; tool: string },
    ) {
        const observable = this.whiteboardService.updateUserPointer({
            room_id: roomId,
            peer_id: peerId,
            position,
        });
        return await firstValueFrom(observable);
    }

    async getPointers(roomId: string) {
        const observable = this.whiteboardService.getPointers({
            room_id: roomId,
        });
        return await firstValueFrom(observable);
    }

    async removeUserPointer(roomId: string, peerId: string) {
        const observable = this.whiteboardService.removeUserPointer({
            room_id: roomId,
            peer_id: peerId,
        });
        return await firstValueFrom(observable);
    }

    // Voting methods
    async createVote(
        roomId: string,
        question: string,
        options: { id: string; text: string }[],
        creatorId: string,
    ) {
        try {
            const observable = this.votingService.createVote({
                room_id: roomId,
                question,
                options,
                creator_id: creatorId,
            });

            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error('[InteractionClient] Error creating vote:', error);
            throw error;
        }
    }

    async submitVote(
        roomId: string,
        voteId: string,
        optionId: string,
        voterId: string,
    ) {
        try {
            const observable = this.votingService.submitVote({
                room_id: roomId,
                vote_id: voteId,
                option_id: optionId,
                voter_id: voterId,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error('[InteractionClient] Error submitting vote:', error);
            throw error;
        }
    }

    async getVoteResults(roomId: string, voteId: string) {
        try {
            const observable = this.votingService.getVoteResults({
                room_id: roomId,
                vote_id: voteId,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error getting vote results:',
                error,
            );
            throw error;
        }
    }

    async endVote(roomId: string, voteId: string, creatorId: string) {
        try {
            const observable = this.votingService.endVote({
                room_id: roomId,
                vote_id: voteId,
                creator_id: creatorId,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error('[InteractionClient] Error ending vote:', error);
            throw error;
        }
    }

    async getActiveVote(roomId: string) {
        try {
            const observable = this.votingService.getActiveVote({
                room_id: roomId,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error getting active vote:',
                error,
            );
            throw error;
        }
    }

    // Quiz methods
    async createQuiz(
        roomId: string,
        title: string,
        questions: any[],
        creatorId: string,
    ) {
        try {
            // Transform questions to match proto structure
            const transformedQuestions = questions.map((question) => {
                const baseQuestion = {
                    id: question.id,
                    text: question.text,
                    type: question.type,
                };

                if (question.type === 'essay') {
                    return {
                        ...baseQuestion,
                        options: [], // Empty for essay questions
                        correct_answers: [], // Empty for essay questions
                        answer: question.answer || '',
                    };
                } else {
                    // For multiple-choice and one-choice questions
                    const options =
                        question.options?.map((opt) => ({
                            id: opt.id,
                            text: opt.text,
                            isCorrect: opt.isCorrect,
                        })) || [];

                    const correctAnswers =
                        question.options
                            ?.filter((opt) => opt.isCorrect)
                            .map((opt) => opt.id) || [];

                    return {
                        ...baseQuestion,
                        options: options,
                        correct_answers: correctAnswers,
                        answer: '', // Empty for multiple-choice questions
                    };
                }
            });
            const observable = this.quizService.createQuiz({
                room_id: roomId,
                title,
                questions: transformedQuestions,
                creator_id: creatorId,
            });

            const result = await firstValueFrom(observable);
            return result;
        } catch (error) {
            console.error('[InteractionClient] Error creating quiz:', error);
            throw error;
        }
    }

    async submitQuiz(
        roomId: string,
        quizId: string,
        participantId: string,
        answers: Array<{
            questionId: string;
            selectedOptions: string[];
            essayAnswer: string;
        }>,
    ) {
        try {
            console.log('[InteractionClient] submitQuiz called with:', {
                roomId,
                quizId,
                participantId,
                answersCount: answers.length,
            });

            const observable = this.quizService.submitQuiz({
                room_id: roomId,
                quiz_id: quizId,
                participant_id: participantId,
                answers: answers.map((answer) => ({
                    question_id: answer.questionId,
                    selected_options: answer.selectedOptions,
                    essay_answer: answer.essayAnswer,
                })),
            });

            console.log(
                '[InteractionClient] Waiting for quiz service response...',
            );
            const result = await firstValueFrom(observable);
            console.log('[InteractionClient] Quiz service response:', result);

            return result;
        } catch (error) {
            console.error('[InteractionClient] Error submitting quiz:', error);
            throw error;
        }
    }

    async getQuizResults(roomId: string, quizId: string) {
        try {
            const observable = this.quizService.getQuizResults({
                room_id: roomId,
                quiz_id: quizId,
            });

            const result = await firstValueFrom(observable);
            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error getting quiz results:',
                error,
            );
            throw error;
        }
    }

    async endQuiz(roomId: string, quizId: string, creatorId: string) {
        try {
            const observable = this.quizService.endQuiz({
                room_id: roomId,
                quiz_id: quizId,
                creator_id: creatorId,
            });

            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error('[InteractionClient] Error ending quiz:', error);
            throw error;
        }
    }

    async getActiveQuiz(roomId: string) {
        try {
            const observable = this.quizService.getActiveQuiz({
                room_id: roomId,
            });

            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error getting active quiz:',
                error,
            );
            throw error;
        }
    }

    // Behavior methods
    async saveUserBehavior(
        userId: string,
        roomId: string,
        events: Array<{ type: string; value: string; time: string }>,
    ) {
        try {
            const observable = this.behaviorService.saveUserBehavior({
                user_id: userId,
                room_id: roomId,
                events,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error saving user behavior:',
                error,
            );
            throw error;
        }
    }

    async setBehaviorMonitorState(roomId: string, isActive: boolean) {
        try {
            const observable = this.behaviorService.setBehaviorMonitorState({
                room_id: roomId,
                is_active: isActive,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error setting behavior monitor state:',
                error,
            );
            throw error;
        }
    }

    async getBehaviorMonitorState(roomId: string) {
        try {
            const observable = this.behaviorService.getBehaviorMonitorState({
                room_id: roomId,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error getting behavior monitor state:',
                error,
            );
            throw error;
        }
    }

    async generateUserLogExcel(roomId: string, userId: string) {
        try {
            const observable = this.behaviorService.generateUserLogExcel({
                room_id: roomId,
                user_id: userId,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error generating user log Excel:',
                error,
            );
            throw error;
        }
    }

    async storeBehaviorLogs(
        roomId: string,
        peerId: string,
        behaviorLogs: Array<{
            type: string;
            value: any;
            time: Date | string | number;
        }>,
    ) {
        try {
            // Convert logs to gRPC format with safe date conversion
            const events = behaviorLogs.map((log) => {
                let timeString: string;
                try {
                    if (log.time instanceof Date) {
                        timeString = log.time.toISOString();
                    } else {
                        // Handle string/number timestamps
                        const date = new Date(log.time);
                        if (isNaN(date.getTime())) {
                            // If invalid date, use current time
                            timeString = new Date().toISOString();
                        } else {
                            timeString = date.toISOString();
                        }
                    }
                } catch (dateError) {
                    // Fallback to current time if any conversion fails
                    timeString = new Date().toISOString();
                }

                return {
                    type: log.type,
                    value: String(log.value),
                    time: timeString,
                };
            });

            const observable = this.behaviorService.saveUserBehavior({
                user_id: peerId,
                room_id: roomId,
                events: events,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error storing behavior logs:',
                error,
            );
            throw error;
        }
    }

    async generateRoomLogExcel(roomId: string) {
        try {
            const observable = this.behaviorService.generateRoomLogExcel({
                room_id: roomId,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error generating room log Excel:',
                error,
            );
            throw error;
        }
    }

    async clearRoomLogs(roomId: string) {
        try {
            const observable = this.behaviorService.clearRoomLogs({
                room_id: roomId,
            });
            const result = await firstValueFrom(observable);

            return result;
        } catch (error) {
            console.error(
                '[InteractionClient] Error clearing room logs:',
                error,
            );
            throw error;
        }
    }
}
