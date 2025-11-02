/**
 * SFU Service Configuration Constants
 * Centralized constants for stream priority and room management
 */

// ============================================================================
// ROOM SIZE THRESHOLDS
// ============================================================================

/**
 * Maximum room size where all users can consume all streams
 * For rooms with ≤ this number, bandwidth optimization is disabled
 */
export const SMALL_ROOM_MAX_USERS = 11;

// ============================================================================
// PRIORITY STREAM CONFIGURATION
// ============================================================================

/**
 * Maximum number of non-speaking users that can be in priority list
 * This is used when room size > SMALL_ROOM_MAX_USERS
 *
 * Priority allocation:
 * - Speaking users: unlimited (always get priority)
 * - Pinned users: unlimited (always get priority)
 * - Special users (screen share, translation): unlimited (always get priority)
 * - Regular users: limited to this number (FIFO based on join order)
 */
export const MAX_PRIORITY_USERS = 11;

/**
 * @deprecated Use MAX_PRIORITY_USERS instead
 * Kept for backward compatibility
 */
export const MAX_PRIORITY_STREAMS = MAX_PRIORITY_USERS;

// ============================================================================
// SPEAKING DETECTION
// ============================================================================

/**
 * Time window (ms) to consider user as "currently speaking"
 * Users who spoke within this window get priority for stream consumption
 */
export const SPEAKING_THRESHOLD_MS = 5000; // 5 seconds

/**
 * Interval (ms) for cleaning up inactive speakers
 */
export const SPEAKER_CLEANUP_INTERVAL_MS = 5000; // 5 seconds

/**
 * Inactivity threshold (ms) for removing speaker from active list
 */
export const SPEAKER_INACTIVITY_THRESHOLD_MS = 5000; // 5 seconds

// ============================================================================
// CONSUMER MANAGEMENT
// ============================================================================

/**
 * Maximum number of active consumers allowed per room
 * Used for dynamic stream management when bandwidth is limited
 */
export const CONSUMER_THRESHOLD = 20;

/**
 * Timeout (ms) for transport connection attempts
 */
export const TRANSPORT_CONNECT_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Timeout (ms) for producer creation
 */
export const PRODUCER_CREATE_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Timeout (ms) for consumer creation
 */
export const CONSUMER_CREATE_TIMEOUT_MS = 10000; // 10 seconds

// ============================================================================
// PRIORITY LEVELS (for documentation)
// ============================================================================

/**
 * Stream Priority Levels (highest to lowest):
 *
 * 0. Pinned users - Always consume (set by user action)
 * 1. Speaking users - Always consume (within SPEAKING_THRESHOLD_MS)
 * 2. Special users - Always consume (screen share, translation, etc.)
 * 3. Priority users - Limited to MAX_PRIORITY_USERS (FIFO order)
 * 4. Other users - Only consume if room size ≤ SMALL_ROOM_MAX_USERS
 */
