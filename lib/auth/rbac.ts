import type { Role } from '@/types';

export type Permission =
  | 'view:templates'
  | 'view:runs'
  | 'analyze'
  | 'retest'
  | 'admin:config'
  | 'admin:registry';

const DEVELOPER_PERMISSIONS: readonly Permission[] = ['view:templates', 'view:runs', 'analyze'];
const ADMIN_PERMISSIONS: readonly Permission[] = [...DEVELOPER_PERMISSIONS, 'retest', 'admin:config', 'admin:registry'];

/**
 * ADMIN: everything. DEVELOPER: read results, run the analysis, and (unless disabled) re-test.
 * Configuration and registry screens are admin-only. Apps Script itself is not reachable through the app at all.
 */
export function can(role: Role, permission: Permission, options: { developerRetest?: boolean } = {}): boolean {
  if (role === 'ADMIN') return ADMIN_PERMISSIONS.includes(permission);
  if (permission === 'retest') return options.developerRetest ?? true;
  return DEVELOPER_PERMISSIONS.includes(permission);
}
