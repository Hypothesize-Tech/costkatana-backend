import bcrypt from 'bcryptjs';
import { loggingService } from './logging.service';

/**
 * Backup Codes Service
 * Handles generation, hashing, and verification of backup codes for 2FA
 */
export class BackupCodesService {
    /**
     * Generate 8 random 10-character alphanumeric backup codes
     * Format: A3F8D2K9B1 (no dashes, uppercase letters and numbers)
     */
    static generateBackupCodes(): string[] {
        const codes: string[] = [];
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        
        for (let i = 0; i < 8; i++) {
            let code = '';
            for (let j = 0; j < 10; j++) {
                const randomIndex = Math.floor(Math.random() * characters.length);
                code += characters[randomIndex];
            }
            codes.push(code);
        }
        
        loggingService.info('Backup codes generated', {
            component: 'BackupCodesService',
            count: codes.length
        });
        
        return codes;
    }

    /**
     * Hash backup codes using bcrypt before storing in database
     * @param codes - Array of plain text backup codes
     * @returns Array of hashed backup codes
     */
    static async hashBackupCodes(codes: string[]): Promise<string[]> {
        try {
            const saltRounds = 10;
            const hashedCodes = await Promise.all(
                codes.map(code => bcrypt.hash(code, saltRounds))
            );
            
            loggingService.info('Backup codes hashed successfully', {
                component: 'BackupCodesService',
                count: hashedCodes.length
            });
            
            return hashedCodes;
        } catch (error) {
            loggingService.error('Error hashing backup codes', {
                component: 'BackupCodesService',
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error('Failed to hash backup codes');
        }
    }

    /**
     * Verify a backup code against stored hashed codes
     * @param code - Plain text backup code to verify
     * @param hashedCodes - Array of hashed backup codes from database
     * @returns Object with verified status and matched code index
     */
    static async verifyBackupCode(
        code: string,
        hashedCodes: string[]
    ): Promise<{ verified: boolean; codeIndex?: number }> {
        try {
            if (!hashedCodes || hashedCodes.length === 0) {
                return { verified: false };
            }

            // Check each hashed code
            for (let i = 0; i < hashedCodes.length; i++) {
                const isMatch = await bcrypt.compare(code, hashedCodes[i]);
                if (isMatch) {
                    loggingService.info('Backup code verified successfully', {
                        component: 'BackupCodesService',
                        codeIndex: i
                    });
                    return { verified: true, codeIndex: i };
                }
            }

            loggingService.warn('Backup code verification failed', {
                component: 'BackupCodesService'
            });
            
            return { verified: false };
        } catch (error) {
            loggingService.error('Error verifying backup code', {
                component: 'BackupCodesService',
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error('Failed to verify backup code');
        }
    }

    /**
     * Format backup codes for text file download
     * @param codes - Array of plain text backup codes
     * @returns Formatted string ready for file download
     */
    static formatCodesForDownload(codes: string[]): string {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS
        
        let content = 'CostKatana Backup Codes\n';
        content += `Generated: ${dateStr} ${timeStr}\n\n`;
        content += 'These codes can be used if you lose access to your authenticator.\n';
        content += 'Each code can only be used once. Keep them in a safe place.\n\n';
        
        codes.forEach((code, index) => {
            content += `${index + 1}. ${code}\n`;
        });
        
        content += '\nImportant: These codes will not be shown again.\n';
        content += 'Store them securely offline (e.g., printed or in a password manager).\n';
        
        loggingService.info('Backup codes formatted for download', {
            component: 'BackupCodesService',
            count: codes.length
        });
        
        return content;
    }

    /**
     * Remove a used backup code from the hashed codes array
     * @param hashedCodes - Array of hashed backup codes
     * @param codeIndex - Index of the code to remove
     * @returns Updated array without the used code
     */
    static removeUsedCode(hashedCodes: string[], codeIndex: number): string[] {
        const updatedCodes = [...hashedCodes];
        updatedCodes.splice(codeIndex, 1);
        
        loggingService.info('Backup code removed after use', {
            component: 'BackupCodesService',
            remainingCodes: updatedCodes.length
        });
        
        return updatedCodes;
    }
}


