import { Injectable } from '@nestjs/common';
import { UserBehaviorLog, UserEvent } from '../interfaces/behavior.interface';
import * as ExcelJS from 'exceljs';

@Injectable()
export class BehaviorService {
  private userLogs = new Map<string, Map<string, UserBehaviorLog>>();
  private behaviorMonitorStates = new Map<string, boolean>();

  private initRoomLogs(roomId: string): void {
    if (!this.userLogs.has(roomId)) {
      this.userLogs.set(roomId, new Map<string, UserBehaviorLog>());
    }
  }

  saveUserBehavior(
    userId: string,
    roomId: string,
    events: UserEvent[],
  ): boolean {
    try {
      this.initRoomLogs(roomId);
      const roomLogs = this.userLogs.get(roomId);

      if (roomLogs && roomLogs.has(userId)) {
        const existingLog = roomLogs.get(userId);
        if (existingLog) {
          existingLog.events = [...existingLog.events, ...events];
          existingLog.lastUpdated = new Date();
          roomLogs.set(userId, existingLog);
        }
      } else if (roomLogs) {
        const newLog: UserBehaviorLog = {
          userId,
          roomId,
          events,
          lastUpdated: new Date(),
        };
        roomLogs.set(userId, newLog);
      }

      console.log(
        `[BehaviorService] Saved ${events.length} events for user ${userId} in room ${roomId}`,
      );
      return true;
    } catch (error) {
      console.error('[BehaviorService] Error saving user behavior:', error);
      return false;
    }
  }

  setBehaviorMonitorState(roomId: string, isActive: boolean): void {
    this.behaviorMonitorStates.set(roomId, isActive);
    console.log(
      `[BehaviorService] Set behavior monitor state for room ${roomId}: ${isActive}`,
    );
  }

  getBehaviorMonitorState(roomId: string): boolean {
    return this.behaviorMonitorStates.get(roomId) || false;
  }

  getUserBehaviorLog(roomId: string, userId: string): UserBehaviorLog | null {
    const roomLogs = this.userLogs.get(roomId);
    if (!roomLogs) {
      return null;
    }
    return roomLogs.get(userId) || null;
  }

  getAllUserLogsInRoom(roomId: string): UserBehaviorLog[] {
    const roomLogs = this.userLogs.get(roomId);
    if (!roomLogs) {
      return [];
    }
    return Array.from(roomLogs.values());
  }

  clearUserLog(roomId: string, userId: string): void {
    const roomLogs = this.userLogs.get(roomId);
    if (roomLogs) {
      roomLogs.delete(userId);
    }
    console.log(
      `[BehaviorService] Cleared logs for user ${userId} in room ${roomId}`,
    );
  }

  clearRoomLogs(roomId: string): void {
    this.userLogs.delete(roomId);
    this.behaviorMonitorStates.delete(roomId);
    console.log(`[BehaviorService] Cleared logs for room ${roomId}`);
  }

  async generateUserLogExcel(roomId: string, userId: string): Promise<Buffer> {
    const userLog = this.getUserBehaviorLog(roomId, userId);
    if (!userLog) {
      throw new Error('User logs not found');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('User Behavior Log');

    worksheet.addRow(['Event Type', 'Value', 'Timestamp']);

    userLog.events.forEach((event) => {
      worksheet.addRow([
        event.type,
        event.value.toString(),
        new Date(event.time).toLocaleString(),
      ]);
    });

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    worksheet.columns.forEach((column) => {
      column.width = 25;
    });

    return (await workbook.xlsx.writeBuffer()) as Buffer;
  }

  async generateRoomLogExcel(roomId: string): Promise<Buffer> {
    const roomLogs = this.getAllUserLogsInRoom(roomId);
    if (!roomLogs || roomLogs.length === 0) {
      throw new Error('Room logs not found');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Room Behavior Logs');

    worksheet.addRow(['User ID', 'Event Type', 'Value', 'Timestamp']);

    roomLogs.forEach((log) => {
      log.events.forEach((event) => {
        worksheet.addRow([
          log.userId,
          event.type,
          event.value.toString(),
          new Date(event.time).toLocaleString(),
        ]);
      });
    });

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    worksheet.columns.forEach((column) => {
      column.width = 25;
    });

    return (await workbook.xlsx.writeBuffer()) as Buffer;
  }
}
