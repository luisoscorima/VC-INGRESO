-- Permisos configurables de módulos de gestión (nav / sidebar)
-- Ejecutar en BDs existentes: mysql ... < database/migrations/001_nav_permissions.sql

CREATE TABLE IF NOT EXISTS `nav_modules` (
    `module_key` VARCHAR(50) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `route` VARCHAR(100) NOT NULL,
    `section` VARCHAR(50) NOT NULL DEFAULT 'gestion' COMMENT 'gestion | admin',
    `sort_order` INT NOT NULL DEFAULT 0,
    `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (`module_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_nav_permissions` (
    `role_system` VARCHAR(50) NOT NULL,
    `module_key` VARCHAR(50) NOT NULL,
    `can_view` TINYINT(1) NOT NULL DEFAULT 0,
    `can_manage` TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (`role_system`, `module_key`),
    KEY `idx_rnp_module` (`module_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `nav_modules` (`module_key`, `label`, `route`, `section`, `sort_order`, `is_enabled`) VALUES
('users', 'Usuarios', '/users', 'gestion', 10, 1),
('houses', 'Viviendas', '/houses', 'gestion', 20, 1),
('vehicles', 'Vehículos', '/vehicles', 'gestion', 30, 1),
('pets', 'Mascotas', '/pets', 'gestion', 40, 1),
('announcements', 'Comunicados', '/announcements', 'gestion', 50, 1),
('surveys', 'Encuestas', '/surveys', 'gestion', 60, 1),
('access_points', 'Puntos de acceso', '/access-points', 'admin', 70, 1)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`), `route` = VALUES(`route`);

INSERT INTO `role_nav_permissions` (`role_system`, `module_key`, `can_view`, `can_manage`) VALUES
('ADMINISTRADOR', 'users', 1, 1),
('ADMINISTRADOR', 'houses', 1, 1),
('ADMINISTRADOR', 'vehicles', 1, 1),
('ADMINISTRADOR', 'pets', 1, 1),
('ADMINISTRADOR', 'announcements', 1, 1),
('ADMINISTRADOR', 'surveys', 1, 1),
('ADMINISTRADOR', 'access_points', 1, 1),
('OPERARIO', 'users', 1, 0),
('OPERARIO', 'houses', 1, 0),
('OPERARIO', 'vehicles', 1, 0),
('OPERARIO', 'pets', 1, 0)
ON DUPLICATE KEY UPDATE `can_view` = VALUES(`can_view`), `can_manage` = VALUES(`can_manage`);
