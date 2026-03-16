import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

@Injectable()
export class BackupCodesService {
  private readonly logger = new Logger(BackupCodesService.name);
  private readonly CODE_COUNT = 8;
  private readonly CODE_LENGTH = 10;

  /**
   * Generate backup codes for TOTP
   */
  generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < this.CODE_COUNT; i++) {
      codes.push(this.generateBackupCode());
    }
    return codes;
  }

  /**
   * Generate a single backup code (10-character alphanumeric)
   */
  private generateBackupCode(): string {
    return crypto
      .randomBytes(5)
      .toString('hex')
      .toUpperCase()
      .substring(0, this.CODE_LENGTH);
  }

  /**
   * Hash backup codes using bcrypt
   */
  async hashBackupCodes(codes: string[]): Promise<string[]> {
    const hashedCodes: string[] = [];
    const saltRounds = 10;

    for (const code of codes) {
      const hashed = await bcrypt.hash(code, saltRounds);
      hashedCodes.push(hashed);
    }

    this.logger.debug(`Hashed ${codes.length} backup codes`);
    return hashedCodes;
  }

  /**
   * Verify a backup code against hashed codes
   */
  async verifyBackupCode(
    code: string,
    hashedCodes: string[],
  ): Promise<{ verified: boolean; codeIndex?: number }> {
    for (let i = 0; i < hashedCodes.length; i++) {
      try {
        const isValid = await bcrypt.compare(code, hashedCodes[i]);
        if (isValid) {
          this.logger.debug(`Backup code verified at index ${i}`);
          return { verified: true, codeIndex: i };
        }
      } catch (error) {
        this.logger.warn(
          `Error verifying backup code at index ${i}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return { verified: false };
  }

  /**
   * Format codes for text file download
   */
  formatCodesForDownload(codes: string[]): string {
    const timestamp = new Date().toISOString();
    const header = `Cost Katana Backup Codes\nGenerated: ${timestamp}\n\n`;
    const instructions = `IMPORTANT: Store these codes securely. Each code can only be used once.\n\n`;
    const codesList = codes
      .map((code, index) => `${index + 1}. ${code}`)
      .join('\n');
    const footer = `\n\nIf you lose access to your authenticator app, use these codes to sign in.\nEach code can only be used once for security.`;

    return header + instructions + codesList + footer;
  }

  /**
   * Remove a used backup code from the array
   */
  removeUsedCode(hashedCodes: string[], codeIndex: number): string[] {
    if (codeIndex < 0 || codeIndex >= hashedCodes.length) {
      throw new Error('Invalid code index');
    }

    const updatedCodes = [...hashedCodes];
    updatedCodes.splice(codeIndex, 1);

    this.logger.debug(
      `Removed backup code at index ${codeIndex}, ${updatedCodes.length} codes remaining`,
    );
    return updatedCodes;
  }
}
