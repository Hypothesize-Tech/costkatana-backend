// Extend Express Request interface for Cortex functionality
declare global {
  namespace Express {
    interface Request {
      cortex?: {
        enabled: boolean;
        options?: {
          modelOverride?: string;
          coreModel?: string;
          encoderModel?: string;
          decoderModel?: string;
          useCache?: boolean;
          compressionLevel?: 'none' | 'basic' | 'aggressive' | 'neural';
          format?: 'plain' | 'markdown' | 'html' | 'json';
          style?: 'formal' | 'casual' | 'technical' | 'simple';
        };
        process?: (input: string) => Promise<{
          response: string;
          metrics: any;
          optimized: boolean;
        }>;
      };
    }
  }
}

export {};
