export function generateRoomId(): string {
    const timestamp = Date.now().toString(36); // Convert timestamp to base-36 string
    const randomPart = Math.random().toString(36).substring(2, 8); // Generate a random part
    return `${timestamp}-${randomPart}`; // Combine both parts
}

/**
 * Generate a unique room key for semantic context isolation
 * Uses crypto for better uniqueness to avoid room_id collisions
 */
export function generateRoomKey(): string {
    const crypto = require('crypto');
    return crypto.randomUUID(); // e.g., "550e8400-e29b-41d4-a716-446655440000"
}
