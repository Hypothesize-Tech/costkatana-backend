import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';

/**
 * Middleware to capture raw body for webhook signature verification
 * This must be used BEFORE express.json() middleware
 */
export function captureRawBody(req: Request, res: Response, next: NextFunction): void {
    if (req.path.includes('/webhook') || req.path.includes('/vercel/webhooks')) {
        const chunks: Buffer[] = [];
        
        req.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });
        
        req.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            (req as any).rawBody = rawBody;
            
            loggingService.debug('Raw body captured for webhook', {
                path: req.path,
                bodyLength: rawBody.length
            });
        });
    }
    
    next();
}

/**
 * Store raw body in request for GitHub webhook signature verification
 * Use this with express.json() middleware
 */
export function storeRawBody(req: Request, res: Response, buf: Buffer, encoding: BufferEncoding): void {
    if (req.path.includes('/webhook') || req.path.includes('/vercel/webhooks')) {
        (req as any).rawBody = buf.toString(encoding || 'utf8');
    }
}

