/**
 * Model ID Sanitizer Utility
 * Removes sensitive information (ARNs, account IDs, regions) from model IDs
 * for safe display in UI and API responses
 */

/**
 * Sanitize a model ID by removing ARN prefixes, account IDs, and region information
 * @param modelId - The raw model ID (may contain ARN, account ID, etc.)
 * @returns Sanitized model ID safe for display
 * 
 * Examples:
 * - "arn:aws:bedrock:us-east-1:148123604300:inference-profile/us.amazon.nova-pro-v1:0" 
 *   -> "amazon.nova-pro-v1:0"
 * - "arn:aws:bedrock:us-east-1:502339147927:inference-profile/us.amazon.nova-pro-v1:0"
 *   -> "amazon.nova-pro-v1:0"
 * - "anthropic.claude-3-5-sonnet-20241022-v1:0" -> "anthropic.claude-3-5-sonnet-20241022-v1:0"
 * - "ai21.jamba-instruct-v1:0" -> "ai21.jamba-instruct-v1:0"
 */
export function sanitizeModelId(modelId: string | null | undefined): string {
  if (!modelId || typeof modelId !== 'string') {
    return modelId || 'Unknown';
  }

  // Handle AWS Bedrock ARNs
  if (modelId.toLowerCase().startsWith('arn:aws:bedrock:')) {
    // Extract the model part after the last '/'
    const parts = modelId.split('/');
    if (parts.length > 1) {
      let modelName = parts[parts.length - 1];
      
      // Remove region prefix (us., eu., ap-southeast-1., etc.) but keep vendor prefix
      // Pattern: us.amazon.nova-pro-v1:0 -> amazon.nova-pro-v1:0
      // Pattern: us.anthropic.claude-3-5-sonnet-20241022-v1:0 -> anthropic.claude-3-5-sonnet-20241022-v1:0
      modelName = modelName.replace(/^(us|eu|ap-[a-z]+-[0-9]+|ca-[a-z]+-[0-9]+|sa-[a-z]+-[0-9]+|me-[a-z]+-[0-9]+|il-[a-z]+-[0-9]+)\./, '');
      
      return modelName;
    }
    
    // If no '/' found, return as-is (shouldn't happen with valid ARNs)
    return modelId;
  }

  // Handle AWS Bedrock inference profile ARNs
  if (modelId.includes('inference-profile/')) {
    const parts = modelId.split('inference-profile/');
    if (parts.length > 1) {
      let modelName = parts[1];
      // Remove region prefix
      modelName = modelName.replace(/^(us|eu|ap-[a-z]+-[0-9]+|ca-[a-z]+-[0-9]+|sa-[a-z]+-[0-9]+|me-[a-z]+-[0-9]+|il-[a-z]+-[0-9]+)\./, '');
      return modelName;
    }
  }

  // For non-ARN models, return as-is (already clean)
  return modelId;
}

/**
 * Extract provider name from a model ID
 * @param modelId - The model ID (sanitized or not)
 * @returns Provider name (e.g., "amazon", "anthropic", "ai21")
 */
export function extractProviderFromModelId(modelId: string | null | undefined): string {
  if (!modelId || typeof modelId !== 'string') {
    return 'Unknown';
  }

  // First sanitize to remove ARN/account info
  const sanitized = sanitizeModelId(modelId);
  
  // Extract provider (first part before first dot)
  const match = sanitized.match(/^([^.]+)/);
  if (match) {
    return match[1];
  }
  
  return 'Unknown';
}

/**
 * Extract a display-friendly model name from a model ID
 * @param modelId - The model ID
 * @returns Display-friendly name (e.g., "Nova Pro", "Claude 3.5 Sonnet")
 */
export function getDisplayModelName(modelId: string | null | undefined): string {
  if (!modelId || typeof modelId !== 'string') {
    return 'Unknown Model';
  }

  const sanitized = sanitizeModelId(modelId);
  
  // Remove version suffixes like ":0", "-v1:0", "-20241022-v1:0"
  let displayName = sanitized
    .replace(/:\d+$/, '') // Remove :0, :1, etc.
    .replace(/-\d{8}-v\d+$/, '') // Remove -20241022-v1
    .replace(/-v\d+$/, '') // Remove -v1
    .replace(/-\d{8}$/, ''); // Remove -20241022

  // Capitalize first letter of each word
  displayName = displayName
    .split('.')
    .map(part => {
      // Handle special cases
      if (part === 'nova-pro') return 'Nova Pro';
      if (part === 'claude') return 'Claude';
      if (part === 'sonnet') return 'Sonnet';
      if (part === 'opus') return 'Opus';
      if (part === 'haiku') return 'Haiku';
      if (part === 'jamba-instruct') return 'Jamba Instruct';
      
      // Default: capitalize first letter
      return part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ');
    })
    .join(' ');

  return displayName;
}

/**
 * Sanitize a provider name by removing ARN prefixes and extracting clean provider name
 * @param provider - The provider string (may contain ARN, account ID, etc.)
 * @returns Sanitized provider name (e.g., "amazon", "anthropic", "ai21")
 */
export function sanitizeProvider(provider: string | null | undefined): string {
  if (!provider || typeof provider !== 'string') {
    return provider || 'Unknown';
  }

  // If it's an ARN or contains ARN-like structure, extract provider from it
  if (provider.toLowerCase().includes('arn:aws:bedrock:') || provider.includes('inference-profile/')) {
    // Try to extract provider from the ARN
    // Pattern: arn:aws:bedrock:us-east-1:148123604300:inference-profile/us.amazon.nova-pro-v1:0
    // Extract the part after inference-profile/ and get the provider
    const parts = provider.split('inference-profile/');
    if (parts.length > 1) {
      const modelPart = parts[1];
      const match = modelPart.match(/^(?:us|eu|ap-[a-z]+-[0-9]+|ca-[a-z]+-[0-9]+|sa-[a-z]+-[0-9]+|me-[a-z]+-[0-9]+|il-[a-z]+-[0-9]+)\.?([^.]+)/);
      if (match && match[2]) {
        return match[2]; // Return the provider name (amazon, anthropic, etc.)
      }
      // Fallback: extract first part after region prefix
      const cleanModel = modelPart.replace(/^(us|eu|ap-[a-z]+-[0-9]+|ca-[a-z]+-[0-9]+|sa-[a-z]+-[0-9]+|me-[a-z]+-[0-9]+|il-[a-z]+-[0-9]+)\./, '');
      const providerMatch = cleanModel.match(/^([^.]+)/);
      if (providerMatch) {
        return providerMatch[1];
      }
    }
  }

  // If it's just a region prefix like "us", return "Unknown"
  if (/^(us|eu|ap-[a-z]+-[0-9]+|ca-[a-z]+-[0-9]+|sa-[a-z]+-[0-9]+|me-[a-z]+-[0-9]+|il-[a-z]+-[0-9]+)$/i.test(provider)) {
    return 'Unknown';
  }

  // If it contains a dot, extract the first part (provider name)
  if (provider.includes('.')) {
    const match = provider.match(/^([^.]+)/);
    if (match) {
      return match[1];
    }
  }

  // Return as-is if it looks like a valid provider name
  return provider;
}

/**
 * Sanitize an object containing model IDs and providers recursively
 * @param obj - Object that may contain model IDs and providers
 * @param fieldsToSanitize - Array of field names to sanitize (default: ['modelId', 'model', 'modelName'])
 * @returns Sanitized object
 */
export function sanitizeModelIdsInObject(
  obj: any,
  fieldsToSanitize: string[] = ['modelId', 'model', 'modelName', 'scopeValue']
): any {
  if (!obj) return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeModelIdsInObject(item, fieldsToSanitize));
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (fieldsToSanitize.includes(key) && typeof value === 'string') {
        // Sanitize model ID fields
        sanitized[key] = sanitizeModelId(value);
        // Also add a displayName if it's a modelId or model field
        if ((key === 'modelId' || key === 'model') && !sanitized.displayName) {
          sanitized.displayName = getDisplayModelName(value);
        }
        // Also add provider if it's a modelId or model field and provider doesn't exist
        if ((key === 'modelId' || key === 'model') && !sanitized.provider) {
          sanitized.provider = extractProviderFromModelId(value);
        }
      } else if (key === 'provider' && typeof value === 'string') {
        // Sanitize provider field specifically
        sanitized.provider = sanitizeProvider(value);
      } else if (typeof value === 'object') {
        // Recursively sanitize nested objects
        sanitized[key] = sanitizeModelIdsInObject(value, fieldsToSanitize);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  return obj;
}

