/** Catálogo de módulos de gestión (sidebar / guards). */
export interface NavModuleDef {
  key: string;
  label: string;
  route: string;
  section: 'gestion' | 'admin';
  icon: string;
  sortOrder: number;
}

export const NAV_MODULE_DEFS: NavModuleDef[] = [
  { key: 'users', label: 'Usuarios', route: '/users', section: 'gestion', icon: 'person', sortOrder: 10 },
  { key: 'houses', label: 'Viviendas', route: '/houses', section: 'gestion', icon: 'apartment', sortOrder: 20 },
  { key: 'vehicles', label: 'Vehículos', route: '/vehicles', section: 'gestion', icon: 'directions_car', sortOrder: 30 },
  { key: 'pets', label: 'Mascotas', route: '/pets', section: 'gestion', icon: 'pets', sortOrder: 40 },
  { key: 'announcements', label: 'Comunicados', route: '/announcements', section: 'gestion', icon: 'campaign', sortOrder: 50 },
  { key: 'surveys', label: 'Encuestas', route: '/surveys', section: 'gestion', icon: 'fact_check', sortOrder: 60 },
  { key: 'access_points', label: 'Puntos de acceso', route: '/access-points', section: 'admin', icon: 'sensor_door', sortOrder: 70 },
];

export const NAV_PERMISSION_ROLES = ['ADMINISTRADOR', 'OPERARIO', 'USUARIO'] as const;

export type NavPermissionRole = (typeof NAV_PERMISSION_ROLES)[number];

export interface ModulePermission {
  view: boolean;
  manage: boolean;
}

export type ResolvedNavPermissions = Record<string, ModulePermission>;

export interface NavModuleRow {
  module_key: string;
  label: string;
  route: string;
  section: string;
  sort_order: number;
  is_enabled: number | boolean;
}

export interface AdminNavMatrix {
  modules: NavModuleRow[];
  roles: string[];
  permissions: Record<string, Record<string, { can_view: number; can_manage: number }>>;
}
