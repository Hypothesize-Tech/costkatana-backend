import { Logger } from '@nestjs/common';

const logger = new Logger('Bedrock');

export function bedrockLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
): void {
  const payload = meta ? `${message} ${JSON.stringify(meta)}` : message;
  switch (level) {
    case 'debug':
      logger.debug?.(payload);
      break;
    case 'info':
      logger.log(payload);
      break;
    case 'warn':
      logger.warn(payload);
      break;
    case 'error':
      logger.error(payload);
      break;
    default:
      logger.log(payload);
  }
}
