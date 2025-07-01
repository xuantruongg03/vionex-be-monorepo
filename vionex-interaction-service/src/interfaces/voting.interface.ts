export interface VoteOption {
  id: string;
  text: string;
  votes: number;
}

export interface VoteSession {
  id: string;
  roomId: string;
  question: string;
  options: VoteOption[];
  creatorId: string;
  isActive: boolean;
  createdAt: string;
  endedAt?: string;
  voters: string[]; // List of peer IDs who have voted
}

export interface VoteData {
  roomId: string;
  voteId: string;
  optionId: string;
  voterId: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  points: number;
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
