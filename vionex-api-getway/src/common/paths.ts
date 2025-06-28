import { resolve } from 'path';

export const protoPaths = {
  room: resolve(__dirname, '../../../protos/room.proto'),
  sfu: resolve(__dirname, '../../../protos/sfu.proto'),
  chat: resolve(__dirname, '../../../protos/chat.proto'),
  whiteboard: resolve(__dirname, '../../../protos/whiteboard.proto'),
  voting: resolve(__dirname, '../../../protos/voting.proto'),
};
