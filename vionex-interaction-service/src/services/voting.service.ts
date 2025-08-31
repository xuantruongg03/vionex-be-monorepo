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
            throw error;
        }

        if (!creatorId) {
            const error = new Error('Invalid vote data: creatorId is required');
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
        return voteSession;
    }

    submitVote(
        roomId: string,
        voteId: string,
        optionId: string,
        voterId: string,
    ): VoteSession | null {

        const voteSession = this.activeVotes.get(voteId);

        if (
            !voteSession ||
            !voteSession.isActive ||
            voteSession.roomId !== roomId
        ) {
            return null;
        }

        // Check if user already voted
        if (voteSession.voters.includes(voterId)) {
            return null;
        }

        // Find and update the option
        const option = voteSession.options.find((opt) => opt.id === optionId);
        if (!option) {
            return null;
        }

        option.votes++;
        voteSession.voters.push(voterId);

        return voteSession;
    }

    getVoteResults(roomId: string, voteId: string): VoteSession | null {
        const voteSession = this.activeVotes.get(voteId);

        if (!voteSession || voteSession.roomId !== roomId) {
            return null;
        }
        return voteSession;
    }

    endVote(
        roomId: string,
        voteId: string,
        creatorId: string,
    ): VoteSession | null {

        const voteSession = this.activeVotes.get(voteId);

        if (
            !voteSession ||
            voteSession.roomId !== roomId ||
            voteSession.creatorId !== creatorId
        ) {
            return null;
        }

        voteSession.isActive = false;
        voteSession.endedAt = new Date().toISOString();
        return voteSession;
    }

    getActiveVote(roomId: string): VoteSession | null {
        for (const voteSession of this.activeVotes.values()) {
            if (voteSession.roomId === roomId && voteSession.isActive) {
                return voteSession;
            }
        }
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
