import { Response, NextFunction } from 'express';
import { eventService } from '../services/event.service';

export class EventController {
    static async subscribe(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            eventService.addClient(res, userId);
        } catch (error) {
            next(error);
        }
    }
} 