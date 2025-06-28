import { resolve } from 'path';

export const protoPaths = {
  room: resolve(__dirname, '../../../protos/room.proto'),
  sfu: resolve(__dirname, '../../../protos/sfu.proto'),
  signaling: resolve(__dirname, '../../../protos/signaling.proto'),
};