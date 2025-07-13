import { resolve } from 'path';

export const protoPaths = {
  room: resolve(__dirname, '../../../protos/room.proto'),
  sfu: resolve(__dirname, '../../../protos/sfu.proto'),
  chat: resolve(__dirname, '../../../protos/chat.proto'),
  interaction: resolve(__dirname, '../../../protos/interaction.proto'),
  audio: resolve(__dirname, '../../../protos/audio.proto'),
  chatbot: resolve(__dirname, '../../../protos/chatbot.proto'),
};
