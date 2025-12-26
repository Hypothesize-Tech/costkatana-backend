// DISABLED: Gmail/Calendar triggers removed - using drive.file scope only
export class GoogleTriggersService {
  static async checkCalendarTriggers() {
    return { matched: false, error: 'Calendar triggers disabled - using drive.file scope only' };
  }
  static async checkGmailTriggers() {
    return { matched: false, error: 'Gmail triggers disabled - using drive.file scope only' };
  }
}
