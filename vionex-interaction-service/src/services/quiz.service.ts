import { Injectable } from '@nestjs/common';

export interface QuizOption {
    id: string;
    text: string;
    isCorrect: boolean;
}

export interface QuizQuestion {
    id: string;
    text: string; // Match proto field name
    type: 'multiple-choice' | 'essay' | 'one-choice'; // Match proto field name
    options?: QuizOption[]; // Match proto field name
    correctAnswers?: string[]; // Match proto field name (correct_answers in proto)
    answer?: string; // For essay questions
    points?: number; // Keep for scoring but not in proto
}

export interface QuizSession {
    id: string;
    roomId: string;
    title: string;
    questions: QuizQuestion[];
    creatorId: string;
    isActive: boolean;
    createdAt: string;
    endedAt?: string;
    participantScores: Map<string, number>; // peer_id -> score
    currentQuestionIndex: number;
    answers: Map<string, Map<string, string>>; // questionId -> participantId -> answer
}

@Injectable()
export class QuizService {
    private activeQuizzes = new Map<string, QuizSession>();
    private quizHistory = new Map<string, QuizSession[]>(); // roomId -> QuizSession[]

    createQuiz(
        roomId: string,
        title: string,
        questions: QuizQuestion[],
        creatorId: string,
    ): QuizSession {
        const quizId = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const quizSession: QuizSession = {
            id: quizId,
            roomId,
            title,
            questions,
            creatorId,
            isActive: true,
            createdAt: new Date().toISOString(),
            participantScores: new Map(),
            currentQuestionIndex: 0,
            answers: new Map(),
        };

        // Initialize answers map
        questions.forEach((question) => {
            quizSession.answers.set(question.id, new Map());
        });

        this.activeQuizzes.set(quizId, quizSession);

        // Add to history
        if (!this.quizHistory.has(roomId)) {
            this.quizHistory.set(roomId, []);
        }
        this.quizHistory.get(roomId)?.push(quizSession);
        return quizSession;
    }

    submitQuiz(
        roomId: string,
        quizId: string,
        participantId: string,
        answers: Array<{
            questionId: string;
            selectedOptions: string[];
            essayAnswer: string;
        }>,
    ): {
        success: boolean;
        totalScore: number;
        totalPossibleScore: number;
        questionResults: Array<{
            questionId: string;
            isCorrect: boolean;
            pointsEarned: number;
            correctAnswers: string[];
        }>;
    } {
        const quizSession = this.activeQuizzes.get(quizId);
        if (
            !quizSession ||
            !quizSession.isActive ||
            quizSession.roomId !== roomId
        ) {
            return {
                success: false,
                totalScore: 0,
                totalPossibleScore: 0,
                questionResults: [],
            };
        }

        // Check if participant already submitted
        if (quizSession.participantScores.has(participantId)) {
            return {
                success: false,
                totalScore: 0,
                totalPossibleScore: 0,
                questionResults: [],
            };
        }

        let totalScore = 0;
        let totalPossibleScore = 0;
        const questionResults: Array<{
            questionId: string;
            isCorrect: boolean;
            pointsEarned: number;
            correctAnswers: string[];
        }> = [];

        // Grade each answer
        answers.forEach((answer) => {
            const question = quizSession.questions.find(
                (q) => q.id === answer.questionId,
            );
            if (!question) {
                return;
            }

            totalPossibleScore += question.points || 1;
            let isCorrect = false;
            let pointsEarned = 0;

            if (question.type === 'essay') {
                // For essay questions, we can't automatically determine correctness
                // This would need manual grading or AI assistance
                isCorrect = false;
                pointsEarned = 0;
            } else if (question.type === 'one-choice') {
                // For single choice, check if answer matches any correct answer
                const selectedOption = answer.selectedOptions[0];
                isCorrect =
                    question.correctAnswers?.includes(selectedOption) || false;
                pointsEarned = isCorrect ? question.points || 1 : 0;
            } else if (question.type === 'multiple-choice') {
                // For multiple choice, check if all selected answers are correct and no incorrect ones are selected
                const correctAnswers = question.correctAnswers || [];
                const selectedAnswers = answer.selectedOptions || [];

                // Check if arrays are equal (same elements, same length)
                const sortedCorrect = [...correctAnswers].sort();
                const sortedSelected = [...selectedAnswers].sort();

                isCorrect =
                    sortedCorrect.length === sortedSelected.length &&
                    sortedCorrect.every(
                        (val, index) => val === sortedSelected[index],
                    );
                pointsEarned = isCorrect ? question.points || 1 : 0;
            }

            totalScore += pointsEarned;
            questionResults.push({
                questionId: answer.questionId,
                isCorrect,
                pointsEarned,
                correctAnswers: question.correctAnswers || [],
            });

            // Store the answer
            const questionAnswers = quizSession.answers.get(answer.questionId);
            if (questionAnswers) {
                questionAnswers.set(participantId, JSON.stringify(answer));
            }
        });

        // Update participant score
        quizSession.participantScores.set(participantId, totalScore);
        return {
            success: true,
            totalScore,
            totalPossibleScore,
            questionResults,
        };
    }

    getQuizResults(roomId: string, quizId: string): QuizSession | null {
        const quizSession = this.activeQuizzes.get(quizId);
        if (!quizSession || quizSession.roomId !== roomId) {
            return null;
        }
        return quizSession;
    }

    endQuiz(
        roomId: string,
        quizId: string,
        creatorId: string,
    ): QuizSession | null {
        const quizSession = this.activeQuizzes.get(quizId);
        if (
            !quizSession ||
            quizSession.roomId !== roomId ||
            quizSession.creatorId !== creatorId
        ) {
            return null;
        }
        quizSession.isActive = false;
        quizSession.endedAt = new Date().toISOString();
        return quizSession;
    }

    getActiveQuiz(roomId: string): QuizSession | null {
        for (const quizSession of this.activeQuizzes.values()) {
            if (quizSession.roomId === roomId && quizSession.isActive) {
                return quizSession;
            }
        }
        return null;
    }

    // Move to next question (for creator)
    nextQuestion(
        roomId: string,
        quizId: string,
        creatorId: string,
    ): QuizSession | null {
        const quizSession = this.activeQuizzes.get(quizId);
        if (
            !quizSession ||
            quizSession.roomId !== roomId ||
            quizSession.creatorId !== creatorId
        ) {
            return null;
        }
        if (
            quizSession.currentQuestionIndex <
            quizSession.questions.length - 1
        ) {
            quizSession.currentQuestionIndex++;
        }
        return quizSession;
    }

    // Get current question for participants
    getCurrentQuestion(roomId: string, quizId: string): QuizQuestion | null {
        const quizSession = this.activeQuizzes.get(quizId);
        if (
            !quizSession ||
            quizSession.roomId !== roomId ||
            !quizSession.isActive
        ) {
            return null;
        }
        const question =
            quizSession.questions[quizSession.currentQuestionIndex] || null;
        return question;
    }

    // Clean up room data when room is empty
    cleanupRoom(roomId: string) {
        // Remove active quizzes for this room
        const quizzesToRemove: string[] = [];
        for (const [quizId, quizSession] of this.activeQuizzes.entries()) {
            if (quizSession.roomId === roomId) {
                quizzesToRemove.push(quizId);
            }
        }
        quizzesToRemove.forEach((quizId) => {
            this.activeQuizzes.delete(quizId);
        });
        // Keep history but could be cleaned up after some time
        // this.quizHistory.delete(roomId);
    }
}
