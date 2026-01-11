import { Response } from 'express';
import { loggingService } from './logging.service';

interface SSEClient {
  id: string;
  response: Response;
}

export class SSEService {
  private static clients = new Map<string, SSEClient[]>();

  static async sendEvent(
    channelId: string,
    eventType: string,
    data: any
  ): Promise<void> {
    const clients = this.clients.get(channelId) || [];
    
    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    
    clients.forEach(client => {
      try {
        client.response.write(message);
      } catch (error) {
        loggingService.error('Failed to send SSE event', {
          error: error instanceof Error ? error.message : String(error),
          channelId,
          clientId: client.id
        });
      }
    });
  }
  
  static addClient(channelId: string, clientId: string, response: Response): void {
    const clients = this.clients.get(channelId) || [];
    clients.push({ id: clientId, response });
    this.clients.set(channelId, clients);
  }
  
  static removeClient(channelId: string, clientId: string): void {
    const clients = this.clients.get(channelId) || [];
    const filtered = clients.filter(c => c.id !== clientId);
    this.clients.set(channelId, filtered);
  }
}