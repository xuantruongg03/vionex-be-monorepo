export function generateRoomId(): string {
  const timestamp = Date.now().toString(36); // Convert timestamp to base-36 string
  const randomPart = Math.random().toString(36).substring(2, 8); // Generate a random part
  return `${timestamp}-${randomPart}`; // Combine both parts
}