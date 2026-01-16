/**
 * Google Command Service
 * PARTIALLY DISABLED: Gmail and Calendar commands removed
 * Using drive.file scope only (non-sensitive)
 */

import { loggingService } from './logging.service';

export class GoogleCommandService {
    /**
     * Execute Google command from chat
     * Note: Gmail and Calendar commands disabled
     */
    static async executeCommand(command: string, _params: any, _connection: any) {
        try {
            // Only Drive commands are supported now
            if (command.includes('gmail') || command.includes('email')) {
                return {
                    success: false,
                    error: 'Gmail commands are no longer supported. We use only non-sensitive OAuth scopes.'
                };
            }

            if (command.includes('calendar') || command.includes('event')) {
                return {
                    success: false,
                    error: 'Calendar commands are no longer supported. We use only non-sensitive OAuth scopes.'
                };
            }

            // Drive commands still work with drive.file scope
            return {
                success: false,
                error: 'Command not recognized or not supported with current OAuth scopes.'
            };
        } catch (error) {
            loggingService.error('Error executing Google command', { error, command });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}

export default GoogleCommandService;
