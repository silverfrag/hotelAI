import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export type ApplicationRole = 'customer' | 'admin';

export const Roles = (...roles: ApplicationRole[]) => SetMetadata(ROLES_KEY, roles);
