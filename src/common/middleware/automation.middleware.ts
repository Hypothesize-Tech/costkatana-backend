import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AutomationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const automationHeader = req.get('x-automation-trigger');
    if (automationHeader) {
      (req as Request & { isAutomation?: boolean }).isAutomation = true;
    }
    next();
  }
}
