/**
 * ECS container initialization helper (e.g. for AWS ECS task metadata, env extraction).
 */

export interface EcsContainerMetadata {
  taskArn?: string;
  family?: string;
  revision?: string;
  desiredStatus?: string;
  knownStatus?: string;
  containers?: Array<{ name: string; image?: string }>;
}

const ECS_METADATA_URI =
  process.env.ECS_CONTAINER_METADATA_URI_V4 ??
  process.env.ECS_CONTAINER_METADATA_URI;

/**
 * Return whether the process is running inside an ECS container.
 */
export function isEcsContainer(): boolean {
  return Boolean(ECS_METADATA_URI);
}

/**
 * Fetch ECS container metadata (requires ECS_CONTAINER_METADATA_URI to be set).
 */
export async function getEcsContainerMetadata(): Promise<EcsContainerMetadata | null> {
  if (!ECS_METADATA_URI) return null;
  try {
    const res = await fetch(ECS_METADATA_URI);
    if (!res.ok) return null;
    return (await res.json()) as EcsContainerMetadata;
  } catch {
    return null;
  }
}

/**
 * Get a safe value for "origin" or "deployment" from ECS or env.
 */
export async function getContainerOrigin(): Promise<string> {
  const meta = await getEcsContainerMetadata();
  if (meta?.taskArn) return meta.taskArn.split('/').pop() ?? 'ecs';
  return process.env.DEPLOYMENT_ID ?? process.env.HOSTNAME ?? 'local';
}
