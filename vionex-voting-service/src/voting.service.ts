import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';

export interface VoteOption {
  id: string;
  text: string;
  count: number;
}

export interface VoteSession {
  id: string;
  roomId: string;
  question: string;
  options: VoteOption[];
  creatorId: string;
  createdAt: Date;
  isActive: boolean;
  voters: Set<string>; // Track who has voted
}

@Injectable()
export class VotingService {
  private activeVotes = new Map<string, VoteSession>(); // Map<roomId, VoteSession>
  private voteHistory = new Map<string, VoteSession[]>(); // Map<roomId, VoteSession[]>

  async createVote(
    roomId: string,
    question: string,
    optionTexts: string[],
    creatorId: string,
  ): Promise<{ success: boolean; voteSession?: VoteSession; error?: string }> {
    try {
      // Check if there's already an active vote in this room
      if (this.activeVotes.has(roomId)) {
        return {
          success: false,
          error: 'There is already an active vote in this room',
        };
      }

      // Create vote options
      const options: VoteOption[] = optionTexts.map((text) => ({
        id: nanoid(),
        text,
        count: 0,
      }));

      // Create vote session
      const voteSession: VoteSession = {
        id: nanoid(),
        roomId,
        question,
        options,
        creatorId,
        createdAt: new Date(),
        isActive: true,
        voters: new Set(),
      };

      // Store active vote
      this.activeVotes.set(roomId, voteSession);

      return {
        success: true,
        voteSession,
      };
    } catch (error) {
      console.error('Error creating vote:', error);
      return {
        success: false,
        error: 'Failed to create vote',
      };
    }
  }

  async submitVote(
    roomId: string,
    voteId: string,
    optionId: string,
    voterId: string,
  ): Promise<{
    success: boolean;
    updatedSession?: VoteSession;
    error?: string;
  }> {
    try {
      const voteSession = this.activeVotes.get(roomId);

      if (!voteSession) {
        return {
          success: false,
          error: 'No active vote found in this room',
        };
      }

      if (voteSession.id !== voteId) {
        return {
          success: false,
          error: 'Vote ID does not match active vote',
        };
      }

      if (!voteSession.isActive) {
        return {
          success: false,
          error: 'Vote is no longer active',
        };
      }

      // Check if user has already voted
      if (voteSession.voters.has(voterId)) {
        return {
          success: false,
          error: 'You have already voted',
        };
      }

      // Find the option and increment count
      const option = voteSession.options.find((opt) => opt.id === optionId);
      if (!option) {
        return {
          success: false,
          error: 'Invalid option ID',
        };
      }

      option.count++;
      voteSession.voters.add(voterId);

      return {
        success: true,
        updatedSession: voteSession,
      };
    } catch (error) {
      console.error('Error submitting vote:', error);
      return {
        success: false,
        error: 'Failed to submit vote',
      };
    }
  }

  async getVoteResults(
    roomId: string,
    voteId: string,
  ): Promise<{ success: boolean; voteSession?: VoteSession }> {
    const voteSession = this.activeVotes.get(roomId);

    if (!voteSession || voteSession.id !== voteId) {
      return {
        success: false,
      };
    }

    return {
      success: true,
      voteSession,
    };
  }

  async endVote(
    roomId: string,
    voteId: string,
    creatorId: string,
  ): Promise<{ success: boolean; finalSession?: VoteSession; error?: string }> {
    try {
      const voteSession = this.activeVotes.get(roomId);

      if (!voteSession) {
        return {
          success: false,
          error: 'No active vote found',
        };
      }

      if (voteSession.id !== voteId) {
        return {
          success: false,
          error: 'Vote ID does not match',
        };
      }

      if (voteSession.creatorId !== creatorId) {
        return {
          success: false,
          error: 'Only the vote creator can end the vote',
        };
      }

      // Mark as inactive
      voteSession.isActive = false;

      // Move to history
      if (!this.voteHistory.has(roomId)) {
        this.voteHistory.set(roomId, []);
      }
      this.voteHistory.get(roomId)?.push(voteSession);

      // Remove from active votes
      this.activeVotes.delete(roomId);

      return {
        success: true,
        finalSession: voteSession,
      };
    } catch (error) {
      console.error('Error ending vote:', error);
      return {
        success: false,
        error: 'Failed to end vote',
      };
    }
  }

  async getActiveVote(
    roomId: string,
  ): Promise<{ success: boolean; activeVote?: VoteSession }> {
    const activeVote = this.activeVotes.get(roomId);

    return {
      success: true,
      activeVote,
    };
  }

  async removeRoomVotes(roomId: string): Promise<void> {
    this.activeVotes.delete(roomId);
    this.voteHistory.delete(roomId);
  }
}
