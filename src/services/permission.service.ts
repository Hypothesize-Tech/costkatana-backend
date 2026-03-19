export {
  PermissionService,
  type Permissions,
} from '../modules/team/services/permission.service';

/**
 * Legacy Express-compat bridge for permission checks. Used by permission.middleware and
 * projectManager.tool. The Nest PermissionService instance MUST be wired via
 * setPermissionServiceInstance() during app bootstrap (main.ts does this).
 *
 * If a permission method is called before the instance is wired, we throw immediately
 * rather than silently denying - this makes bootstrap misconfiguration visible.
 */
import { PermissionService as NestPermissionService } from '../modules/team/services/permission.service';

let _permissionInstance: InstanceType<typeof NestPermissionService> | null = null;

export function setPermissionServiceInstance(
  instance: InstanceType<typeof NestPermissionService>,
) {
  _permissionInstance = instance;
}

function throwIfNotWired(prop: string): never {
  throw new Error(
    `PermissionService instance not wired. setPermissionServiceInstance() must be called during app bootstrap. ` +
      `Called property: ${prop}. Check that main.ts invokes setPermissionServiceInstance(app.get(PermissionService)) before starting the server.`,
  );
}

export const permissionService = new Proxy(
  {} as InstanceType<typeof NestPermissionService>,
  {
    get(_, prop) {
      if (!_permissionInstance) {
        return () => throwIfNotWired(String(prop));
      }
      const method = (_permissionInstance as Record<string, unknown>)[prop as string];
      return typeof method === 'function' ? method.bind(_permissionInstance) : method;
    },
  },
);
