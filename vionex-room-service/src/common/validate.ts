export function isValidRoomId(roomId: string): boolean {
  return typeof roomId === 'string' && roomId.trim() !== '';
}
