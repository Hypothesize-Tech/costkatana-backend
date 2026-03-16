/**
 * ChatGPT integration API key (ck_user_*) stored on User.apiKeys.
 */
export interface IApiKey {
  id: string;
  name: string;
  key: string;
  created: Date;
  lastUsed?: Date;
  isActive: boolean;
}

export interface ApiKeyValidationResult {
  userId: string;
  user: unknown;
}
