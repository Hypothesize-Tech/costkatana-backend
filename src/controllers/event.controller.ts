import { Request, Response, NextFunction } from 'express';
import { eventService } from '../services';

export class EventController {
    static async subscribe(_req: Request, res: Response, next: NextFunction) {
        try {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();

            eventService.addClient(res);

            // Send a welcome message
            res.write('event: connected\ndata: {"message":"Connection established successfully"}\n\n');

        } catch (error) {
            next(error);
        }
    }
} 