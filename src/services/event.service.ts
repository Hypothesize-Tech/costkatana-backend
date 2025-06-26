import { Response } from 'express';
import { logger } from '../utils/logger';

interface Client {
    id: number;
    response: Response;
}

class EventService {
    private clients: Client[] = [];
    private nextClientId = 1;

    public addClient(response: Response): number {
        const clientId = this.nextClientId++;
        const newClient: Client = {
            id: clientId,
            response,
        };
        this.clients.push(newClient);

        response.on('close', () => {
            this.removeClient(clientId);
            logger.info(`Client ${clientId} disconnected`);
        });

        logger.info(`Client ${clientId} connected`);
        return clientId;
    }

    public removeClient(clientId: number): void {
        this.clients = this.clients.filter(client => client.id !== clientId);
    }

    public sendEvent<T>(eventName: string, data: T): void {
        const eventString = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        this.clients.forEach(client => {
            client.response.write(eventString);
        });
    }
}

export const eventService = new EventService(); 