// DISABLED: Calendar sync removed - using drive.file scope only
export class CalendarSyncService {
  static async syncCalendar() {
    return { success: false, error: 'Calendar sync disabled - using drive.file scope only' };
  }
  static async cleanupEvents() {
    return { success: false, error: 'Calendar sync disabled - using drive.file scope only' };
  }
}
