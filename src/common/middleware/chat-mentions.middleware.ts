import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class ChatMentionsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const body = req.body as Record<string, unknown>;
    const message = (body?.message ?? body?.text ?? '') as string;
    const mentions = message.match(/@[\w.-]+/g) ?? [];
    if (mentions.length > 0) {
      (req as Request & { mentions?: string[] }).mentions = mentions;
    }
    next();
  }
}
