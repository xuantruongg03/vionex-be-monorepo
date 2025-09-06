/**
 * SDP (Session Description Protocol) Helper Functions
 *
 * This module provides utilities for sanitizing identifiers to be SDP-compliant
 * according to RFC standards for WebRTC and MediaSoup.
 */

/**
 * Sanitizes an identifier to be SDP-compliant (ASCII alphanumeric + underscore/dash only)
 *
 * @param id - The identifier string to sanitize
 * @param maxLength - Maximum length of the sanitized identifier (default: 50)
 * @returns Sanitized identifier safe for use in SDP fields like mid, cname, streamId
 *
 * @example
 * ```typescript
 * sanitizeId("Quốc Huy") // Returns: "Qu_c_Huy"
 * sanitizeId("test@room#123") // Returns: "test_room_123"
 * sanitizeId("very-long-identifier-that-exceeds-fifty-characters-limit") // Returns: "very_long_identifier_that_exceeds_fifty_characte"
 * ```
 *
 * RFC References:
 * - RFC 5888: Media ID (mid) format requirements
 * - RFC 3550: RTCP Canonical Name (cname) format requirements
 */
export function sanitizeId(id: string, maxLength: number = 50): string {
    if (!id || typeof id !== 'string') {
        return 'unknown';
    }

    return (
        id
            .replace(/[^\w\-]/g, '_') // Replace non-alphanumeric (except underscore/dash) with underscore
            .replace(/_{2,}/g, '_') // Replace multiple consecutive underscores with single underscore
            .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
            .substring(0, maxLength) || // Limit length
        'fallback'
    ); // Fallback if result is empty
}

/**
 * Creates a safe cabin ID for translation systems
 *
 * @param roomId - Room identifier
 * @param targetUserId - Target user identifier
 * @param sourceLanguage - Source language code
 * @param targetLanguage - Target language code
 * @returns Object containing both original and sanitized cabin IDs
 */
export function createSafeCabinId(
    roomId: string,
    targetUserId: string,
    sourceLanguage: string,
    targetLanguage: string,
): {
    original: string;
    safe: string;
    components: {
        safeRoomId: string;
        safeTargetUserId: string;
        safeSourceLanguage: string;
        safeTargetLanguage: string;
    };
} {
    // Original cabin ID (for storage keys - can contain Unicode)
    const original = `${roomId}_${targetUserId}_${sourceLanguage}_${targetLanguage}`;

    // Safe components for MediaSoup (ASCII only)
    const safeRoomId = sanitizeId(roomId);
    const safeTargetUserId = sanitizeId(targetUserId);
    const safeSourceLanguage = sanitizeId(sourceLanguage);
    const safeTargetLanguage = sanitizeId(targetLanguage);

    // Safe cabin ID (for MediaSoup fields)
    const safe = `${safeRoomId}_${safeTargetUserId}_${safeSourceLanguage}_${safeTargetLanguage}`;

    return {
        original,
        safe,
        components: {
            safeRoomId,
            safeTargetUserId,
            safeSourceLanguage,
            safeTargetLanguage,
        },
    };
}

/**
 * Creates a safe stream ID for translated audio streams
 *
 * @param roomId - Room identifier
 * @param sourceLanguage - Source language code
 * @param targetLanguage - Target language code
 * @param timestamp - Optional timestamp (defaults to current time)
 * @returns Safe stream identifier for MediaSoup
 */
export function createSafeTranslatedStreamId(
    roomId: string,
    sourceLanguage: string,
    targetLanguage: string,
    timestamp?: number,
): string {
    const safeRoomId = sanitizeId(roomId);
    const safeSourceLanguage = sanitizeId(sourceLanguage);
    const safeTargetLanguage = sanitizeId(targetLanguage);
    const ts = timestamp || Date.now();
    const randomSuffix = Math.random().toString(36).substr(2, 6);

    return `translated_${safeRoomId}_${ts}_${randomSuffix}_${safeSourceLanguage}_${safeTargetLanguage}`;
}

/**
 * Validates if an identifier is SDP-compliant
 *
 * @param id - Identifier to validate
 * @returns True if the identifier is SDP-compliant
 */
export function isValidSdpId(id: string): boolean {
    if (!id || typeof id !== 'string') {
        return false;
    }

    // Check if contains only ASCII alphanumeric, underscore, and dash
    return /^[\w\-]+$/.test(id) && id.length <= 50;
}
