import { Response } from 'express';
import { logger } from '../utils/logger';

interface Client {
    id: string;
    res: Response;
}

class EventService {
    private clients: Client[] = [];

    constructor() {
        // Periodically ping clients to keep connections open
        setInterval(() => {
            this.clients.forEach(client => {
                client.res.write(': ping\\n\\n');
            });
        }, 20000);
    }

    addClient(res: Response, userId: string) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const client: Client = { id: userId, res };
        this.clients.push(client);

        logger.info(`SSE client connected: ${userId}`);

        // Send a welcome message
        this.sendToClient(userId, 'connected', {
            message: 'Connection established successfully'
        });

        res.on('close', () => {
            this.removeClient(userId);
        });
    }

    removeClient(userId: string) {
        this.clients = this.clients.filter(client => client.id !== userId);
        logger.info(`SSE client disconnected: ${userId}`);
    }

    sendToClient(userId: string, event: string, data: any) {
        const client = this.clients.find(c => c.id === userId);
        if (client) {
            client.res.write(`event: ${event}\\n`);
            client.res.write(`data: ${JSON.stringify(data)}\\n\\n`);
        }
    }

    broadcast(event: string, data: any) {
        if (this.clients.length === 0) {
            return;
        }
        logger.info(`Broadcasting event '${event}' to ${this.clients.length} clients`);
        this.clients.forEach(client => {
            client.res.write(`event: ${event}\\n`);
            client.res.write(`data: ${JSON.stringify(data)}\\n\\n`);
        });
    }
}

export const eventService = new EventService(); 