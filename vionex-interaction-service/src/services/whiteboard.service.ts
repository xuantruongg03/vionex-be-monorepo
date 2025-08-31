import { Injectable } from '@nestjs/common';
import { PositionMouse, MouseUser } from '../interfaces/whiteboard.inteface';
import { RoomClientService } from '../clients/room.client';

@Injectable()
export class WhiteboardService {
    private whiteboardData = new Map<string, any>();
    private positionMouse = new Map<string, Map<string, MouseUser>>();
    private whiteboardPermissions = new Map<string, string[]>();

    constructor(private readonly roomClient: RoomClientService) {}

    // Whiteboard data management
    updateWhiteboardData(roomId: string, elements: any[], state: any) {
        // Check if elements is valid
        if (!elements || !Array.isArray(elements)) {
            return {
                elements: [],
                state,
                updatedAt: new Date().toISOString(),
            };
        }

        // Validate and fix elements before saving
        const validatedElements = elements.map((element) => {
            if (element.type === 'freedraw' && !element.points) {
                return {
                    ...element,
                    points: [], // Add empty points array to prevent crash
                };
            }
            return element;
        });

        const data = {
            elements: validatedElements,
            state,
            updatedAt: new Date().toISOString(),
        };
        this.whiteboardData.set(roomId, data);
        return data;
    }

    getWhiteboardData(roomId: string) {
        const data = this.whiteboardData.get(roomId) || null;

        // Return the data in the expected format
        if (data) {
            return {
                success: true,
                elements: data.elements,
                state: data.state,
                version: 1,
                timestamp: data.updatedAt,
            };
        }

        return {
            success: true,
            elements: [],
            state: {},
            version: 0,
            timestamp: new Date().toISOString(),
        };
    }

    clearWhiteboard(roomId: string) {
        this.whiteboardData.set(roomId, {
            elements: [],
            state: null,
            updatedAt: new Date().toISOString(),
        });
        return true;
    }

    // Permissions management
    updatePermissions(roomId: string, allowedUsers: string[]) {
        this.whiteboardPermissions.set(roomId, allowedUsers);
        return {
            success: true,
            allowed_users: allowedUsers,
        };
    }

    getPermissions(roomId: string) {
        const permissions = this.whiteboardPermissions.get(roomId) || [];
        return {
            success: true,
            allowed_users: permissions,
        };
    }

    // Initialize permissions for a new room with creator
    initializeRoomPermissions(roomId: string, creatorPeerId: string) {
        // Don't add creator to allowed_users by default, but ensure they can draw
        // The canUserDraw method will handle creator permission check
        if (!this.whiteboardPermissions.has(roomId)) {
            this.whiteboardPermissions.set(roomId, []);
        }

        // Initialize empty whiteboard data if not exists
        if (!this.whiteboardData.has(roomId)) {
            this.whiteboardData.set(roomId, {
                elements: [],
                state: {},
                updatedAt: new Date().toISOString(),
            });
        }
    }

    async canUserDraw(roomId: string, peerId: string): Promise<boolean> {
        try {
            // First check if user has explicit permission
            const permissions = this.whiteboardPermissions.get(roomId) || [];

            if (permissions.includes(peerId)) {
                return true;
            }

            // Then check if user is creator by getting participant info from room service
            const participant = await this.roomClient.getParticipantByPeerId(
                roomId,
                peerId,
            );

            if (participant && participant.is_creator) {
                return true;
            }

            // Additional check: if permissions array is empty, assume this is a new room
            // and allow the first user to draw (likely the creator)
            if (permissions.length === 0) {
                const isCreatorOrFallback = participant?.is_creator || false;
                return isCreatorOrFallback;
            }

            return false;
        } catch (error) {
            // Fallback logic: if we can't check creator status
            const permissions = this.whiteboardPermissions.get(roomId) || [];

            // If user has explicit permission, allow
            if (permissions.includes(peerId)) {
                return true;
            }

            // If permissions are empty (new room), allow as potential creator
            if (permissions.length === 0) {
                return true;
            }

            return false;
        }
    }
    // Pointer management
    updateUserPointer(roomId: string, peerId: string, position: PositionMouse) {
        if (!this.positionMouse.has(roomId)) {
            this.positionMouse.set(roomId, new Map());
        }

        const pointersInRoom = this.positionMouse.get(roomId);
        if (!pointersInRoom) return [];

        pointersInRoom.set(peerId, { position, peerId });

        return this.getPointers(roomId);
    }

    getPointers(roomId: string) {
        const pointersMap = this.positionMouse.get(roomId);
        if (!pointersMap) return [];

        return Array.from(pointersMap.values());
    }

    removeUserPointer(roomId: string, peerId: string) {
        const pointersMap = this.positionMouse.get(roomId);
        if (pointersMap) {
            pointersMap.delete(peerId);
        }
        return this.getPointers(roomId);
    }

    // Clean up room data when room is empty
    cleanupRoom(roomId: string) {
        this.whiteboardData.delete(roomId);
        this.positionMouse.delete(roomId);
        this.whiteboardPermissions.delete(roomId);
    }
}
