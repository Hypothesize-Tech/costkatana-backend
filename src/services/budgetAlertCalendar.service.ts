// DISABLED: Calendar features removed - using drive.file scope only
export class BudgetAlertCalendarService {
  static async syncBudgetAlerts() {
    return { success: false, error: 'Calendar features disabled - using drive.file scope only' };
  }
  static async createCalendarEvent() {
    return { success: false, error: 'Calendar features disabled - using drive.file scope only' };
  }
  static async updateCalendarEvent() {
    return { success: false, error: 'Calendar features disabled - using drive.file scope only' };
  }
  static async deleteCalendarEvent() {
    return { success: false, error: 'Calendar features disabled - using drive.file scope only' };
  }
}
