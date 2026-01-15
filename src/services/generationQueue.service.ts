import { GenerationDecision } from './generationDecision.service';
import { loggingService } from './logging.service';

export interface QueuedGeneration {
    id: string;
    userId: string;
    repoFullName: string;
    request: string;
    decision: GenerationDecision;
    priority: number;
    queuedAt: Date;
    status: 'pending' | 'processing' | 'completed' | 'failed';
}

/**
 * Generation priority queue service
 * Manages generation requests with priority scoring
 */
export class GenerationQueueService {
    private static queue: QueuedGeneration[] = [];
    private static readonly MAX_QUEUE_SIZE = 1000;

    /**
     * Add generation request to queue
     */
    static async enqueue(
        userId: string,
        repoFullName: string,
        request: string,
        decision: GenerationDecision,
        priority?: number
    ): Promise<string> {
        // Calculate priority if not provided
        const calculatedPriority = priority ?? this.calculatePriority(decision, request);

        const queuedItem: QueuedGeneration = {
            id: `gen_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            userId,
            repoFullName,
            request,
            decision,
            priority: calculatedPriority,
            queuedAt: new Date(),
            status: 'pending'
        };

        // Insert in priority order
        const insertIndex = this.queue.findIndex(item => item.priority < calculatedPriority);
        if (insertIndex === -1) {
            this.queue.push(queuedItem);
        } else {
            this.queue.splice(insertIndex, 0, queuedItem);
        }

        // Limit queue size
        if (this.queue.length > this.MAX_QUEUE_SIZE) {
            this.queue = this.queue.slice(0, this.MAX_QUEUE_SIZE);
        }

        loggingService.info('Generation request queued', {
            component: 'GenerationQueueService',
            queueId: queuedItem.id,
            priority: calculatedPriority,
            queueLength: this.queue.length
        });

        return queuedItem.id;
    }

    /**
     * Get next item from queue
     */
    static dequeue(): QueuedGeneration | null {
        const item = this.queue.find(item => item.status === 'pending');
        if (item) {
            item.status = 'processing';
            return item;
        }
        return null;
    }

    /**
     * Calculate priority score
     */
    private static calculatePriority(
        decision: GenerationDecision,
        _request: string
    ): number {
        // Base priority factors
        let priority = 0.5; // Default

        // Higher priority for low-risk, high-impact items
        if (decision.riskLevel === 'low') {
            priority += 0.2;
        } else if (decision.riskLevel === 'high') {
            priority -= 0.2;
        }

        // Higher priority for smaller scope (faster to process)
        const scopeMultipliers: Record<string, number> = {
            'function': 0.3,
            'file': 0.5,
            'module': 0.7,
            'repository': 1.0
        };
        priority += (1 - (scopeMultipliers[decision.scope] || 0.5)) * 0.2;

        // Higher priority for test generation (high value, low risk)
        if (decision.generationType === 'test') {
            priority += 0.3;
        }

        return Math.max(0, Math.min(1, priority));
    }

    /**
     * Get queue status
     */
    static getQueueStatus(): {
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    } {
        return {
            total: this.queue.length,
            pending: this.queue.filter(item => item.status === 'pending').length,
            processing: this.queue.filter(item => item.status === 'processing').length,
            completed: this.queue.filter(item => item.status === 'completed').length,
            failed: this.queue.filter(item => item.status === 'failed').length
        };
    }

    /**
     * Mark item as completed
     */
    static markCompleted(queueId: string): void {
        const item = this.queue.find(item => item.id === queueId);
        if (item) {
            item.status = 'completed';
        }
    }

    /**
     * Mark item as failed
     */
    static markFailed(queueId: string): void {
        const item = this.queue.find(item => item.id === queueId);
        if (item) {
            item.status = 'failed';
        }
    }
}

