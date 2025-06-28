import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import { CircuitBreaker, RetryUtil } from 'src/utils/resilience';

export interface VoteOption {
  id: string;
  text: string;
  count: number;
}

export interface VoteSession {
  id: string;
  room_id: string;
  question: string;
  options: VoteOption[];
  creator_id: string;
  created_at: string;
  is_active: boolean;
  voters: string[];
}

export interface VotingGrpcService {
  createVote(data: {
    room_id: string;
    question: string;
    option_texts: string[];
    creator_id: string;
  }): Observable<{
    success: boolean;
    vote_session?: VoteSession;
    error?: string;
  }>;

  submitVote(data: {
    room_id: string;
    vote_id: string;
    option_id: string;
    voter_id: string;
  }): Observable<{
    success: boolean;
    updated_session?: VoteSession;
    error?: string;
  }>;

  getVoteResults(data: { room_id: string; vote_id: string }): Observable<{
    success: boolean;
    vote_session?: VoteSession;
  }>;

  endVote(data: {
    room_id: string;
    vote_id: string;
    creator_id: string;
  }): Observable<{
    success: boolean;
    final_session?: VoteSession;
  }>;

  getActiveVote(data: { room_id: string }): Observable<{
    success: boolean;
    active_vote?: VoteSession;
  }>;
}

@Injectable()
export class VotingClientService implements OnModuleInit {
  private votingService: VotingGrpcService;
  private circuitBreaker = new CircuitBreaker(5, 60000);

  constructor(@Inject('VOTING_SERVICE') private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.votingService =
      this.client.getService<VotingGrpcService>('VotingService');
  }

  async createVote(data: {
    room_id: string;
    question: string;
    option_texts: string[];
    creator_id: string;
  }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.votingService.createVote(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async submitVote(data: {
    room_id: string;
    vote_id: string;
    option_id: string;
    voter_id: string;
  }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.votingService.submitVote(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async getVoteResults(data: { room_id: string; vote_id: string }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.votingService.getVoteResults(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async endVote(data: {
    room_id: string;
    vote_id: string;
    creator_id: string;
  }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.votingService.endVote(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async getActiveVote(data: { room_id: string }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.votingService.getActiveVote(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }
}
