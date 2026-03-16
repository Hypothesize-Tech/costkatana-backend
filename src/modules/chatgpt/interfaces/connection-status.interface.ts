export interface ConnectionStatus {
  connected: boolean;
  userId?: string;
  user?: Record<string, unknown>;
  message: string;
  needsOnboarding?: boolean;
  magicLinkRequired?: boolean;
}
