export {
  PermissionService,
  type Permissions,
} from '../modules/team/services/permission.service';

// For legacy Express middleware - needs instance; use Nest ModuleRef or this placeholder
import { PermissionService as NestPermissionService } from '../modules/team/services/permission.service';

let _permissionInstance: InstanceType<typeof NestPermissionService> | null = null;

export function setPermissionServiceInstance(
  instance: InstanceType<typeof NestPermissionService>,
) {
  _permissionInstance = instance;
}

export const permissionService = new Proxy({} as InstanceType<typeof NestPermissionService>, {
  get(_, prop) {
    return _permissionInstance
      ? (_permissionInstance as any)[prop]
      : () => Promise.resolve(false);
  },
});
