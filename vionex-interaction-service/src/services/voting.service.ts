import { Injectable } from '@nestjs/common';

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

@Injectable()
export class VotingService {
  private activeVotes = new Map<string, VoteSession>();
  private voteHistory = new Map<string, VoteSession[]>(); // roomId -> VoteSession[]

  createVote(
    roomId: string,
    question: string,
    options: { id: string; text: string }[],
    creatorId: string,
  ): VoteSession {
    console.log('🗳️ [VotingService] createVote called:', {
      roomId,
      question,
      optionsCount: options?.length,
      creatorId,
      options,
    });

    if (
      !roomId ||
      !question ||
      !options ||
      !Array.isArray(options) ||
      options.length < 2
    ) {
      const error = new Error(
        'Invalid vote data: roomId, question, and at least 2 options are required',
      );
      console.error('🗳️ [VotingService] Validation error:', error.message);
      throw error;
    }

    if (!creatorId) {
      const error = new Error('Invalid vote data: creatorId is required');
      console.error('🗳️ [VotingService] Validation error:', error.message);
      throw error;
    }

    const voteId = `vote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const voteSession: VoteSession = {
      id: voteId,
      roomId,
      question,
      options: options.map((opt) => ({ ...opt, votes: 0 })),
      creatorId,
      isActive: true,
      createdAt: new Date().toISOString(),
      voters: [],
    };

    this.activeVotes.set(voteId, voteSession);

    // Add to history
    if (!this.voteHistory.has(roomId)) {
      this.voteHistory.set(roomId, []);
    }
    this.voteHistory.get(roomId)?.push(voteSession);

    console.log('🗳️ [VotingService] Vote created successfully:', {
      voteId: voteSession.id,
      activeVotesCount: this.activeVotes.size,
      historyCount: this.voteHistory.get(roomId)?.length || 0,
    });

    return voteSession;
  }

  submitVote(
    roomId: string,
    voteId: string,
    optionId: string,
    voterId: string,
  ): VoteSession | null {
    console.log('🗳️ [VotingService] submitVote called:', {
      roomId,
      voteId,
      optionId,
      voterId,
    });

    const voteSession = this.activeVotes.get(voteId);

    if (
      !voteSession ||
      !voteSession.isActive ||
      voteSession.roomId !== roomId
    ) {
      console.log(
        '🗳️ [VotingService] Submit vote failed - vote not found or inactive:',
        {
          hasVoteSession: !!voteSession,
          isActive: voteSession?.isActive,
          matchesRoom: voteSession?.roomId === roomId,
        },
      );
      return null;
    }

    // Check if user already voted
    if (voteSession.voters.includes(voterId)) {
      console.log(
        '🗳️ [VotingService] Submit vote failed - user already voted:',
        {
          voterId,
          currentVoters: voteSession.voters,
        },
      );
      return null;
    }

    // Find and update the option
    const option = voteSession.options.find((opt) => opt.id === optionId);
    if (!option) {
      console.log('🗳️ [VotingService] Submit vote failed - option not found:', {
        optionId,
        availableOptions: voteSession.options.map((opt) => opt.id),
      });
      return null;
    }

    option.votes++;
    voteSession.voters.push(voterId);

    console.log('🗳️ [VotingService] Vote submitted successfully:', {
      voteId: voteSession.id,
      optionId,
      optionVotes: option.votes,
      totalVoters: voteSession.voters.length,
    });

    return voteSession;
  }

  getVoteResults(roomId: string, voteId: string): VoteSession | null {
    console.log('🗳️ [VotingService] getVoteResults called:', {
      roomId,
      voteId,
    });

    const voteSession = this.activeVotes.get(voteId);

    if (!voteSession || voteSession.roomId !== roomId) {
      console.log(
        '🗳️ [VotingService] Get vote results failed - vote not found:',
        {
          hasVoteSession: !!voteSession,
          matchesRoom: voteSession?.roomId === roomId,
        },
      );
      return null;
    }

    console.log('🗳️ [VotingService] Vote results retrieved successfully:', {
      voteId: voteSession.id,
      roomId: voteSession.roomId,
      isActive: voteSession.isActive,
      votersCount: voteSession.voters.length,
      optionsCount: voteSession.options.length,
    });

    return voteSession;
  }

  endVote(
    roomId: string,
    voteId: string,
    creatorId: string,
  ): VoteSession | null {
    console.log('🗳️ [VotingService] endVote called:', {
      roomId,
      voteId,
      creatorId,
    });

    const voteSession = this.activeVotes.get(voteId);

    if (
      !voteSession ||
      voteSession.roomId !== roomId ||
      voteSession.creatorId !== creatorId
    ) {
      console.log(
        '🗳️ [VotingService] End vote failed - vote not found or unauthorized:',
        {
          hasVoteSession: !!voteSession,
          matchesRoom: voteSession?.roomId === roomId,
          matchesCreator: voteSession?.creatorId === creatorId,
        },
      );
      return null;
    }

    voteSession.isActive = false;
    voteSession.endedAt = new Date().toISOString();

    console.log('🗳️ [VotingService] Vote ended successfully:', {
      voteId: voteSession.id,
      roomId: voteSession.roomId,
      endedAt: voteSession.endedAt,
      votersCount: voteSession.voters.length,
    });

    return voteSession;
  }

  getActiveVote(roomId: string): VoteSession | null {
    console.log('🗳️ [VotingService] getActiveVote called:', {
      roomId,
      totalActiveVotes: this.activeVotes.size,
    });

    for (const voteSession of this.activeVotes.values()) {
      if (voteSession.roomId === roomId && voteSession.isActive) {
        console.log('🗳️ [VotingService] Active vote found:', {
          voteId: voteSession.id,
          roomId: voteSession.roomId,
          question: voteSession.question,
          votersCount: voteSession.voters.length,
        });
        return voteSession;
      }
    }

    console.log('🗳️ [VotingService] No active vote found for room:', roomId);
    return null;
  }

  // Clean up room data when room is empty
  cleanupRoom(roomId: string) {
    // Remove active votes for this room
    const votesToRemove: string[] = [];
    for (const [voteId, voteSession] of this.activeVotes.entries()) {
      if (voteSession.roomId === roomId) {
        votesToRemove.push(voteId);
      }
    }

    votesToRemove.forEach((voteId) => {
      this.activeVotes.delete(voteId);
    });

    // Keep history but could be cleaned up after some time
    // this.voteHistory.delete(roomId);
  }
}
