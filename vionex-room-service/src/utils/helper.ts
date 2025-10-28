import * as crypto from 'crypto';
import { CONSTANTS } from '../lib/constants';
/**
 * Generate short, memorable room ID
 * Format: XXXXXXXX (8 characters, no dashes)
 * Example: AB3D4EF6, K7M2NPQ8, R5T6UVW9
 * Character set: uppercase letters + numbers (excluding confusing chars: 0, O, 1, I, L)
 */
function generateShortRoomId(): string {
    // Safe characters (no 0, O, 1, I, L to avoid confusion)
    const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    
    let roomId = '';
    for (let i = 0; i < CONSTANTS.LENGTH_ID; i++) {
        const randomIndex = crypto.randomInt(0, chars.length);
        roomId += chars[randomIndex];
    }
    
    return roomId; // e.g., "AB3D4EF6"
}

export { generateShortRoomId };
