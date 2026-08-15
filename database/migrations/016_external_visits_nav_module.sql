-- Separar Visitas externas de Vehículos en la matriz nav de permisos.

INSERT INTO `nav_modules`
    (`module_key`, `label`, `route`, `section`, `sort_order`, `is_enabled`)
VALUES
    ('external_visits', 'Visitas externas', '/external-visits', 'gestion', 35, 1)
ON DUPLICATE KEY UPDATE
    `label` = VALUES(`label`),
    `route` = VALUES(`route`),
    `section` = VALUES(`section`),
    `sort_order` = VALUES(`sort_order`),
    `is_enabled` = VALUES(`is_enabled`);

INSERT INTO `role_nav_permissions`
    (`role_system`, `module_key`, `can_view`, `can_manage`)
VALUES
    ('ADMINISTRADOR', 'external_visits', 1, 1),
    ('OPERARIO', 'external_visits', 1, 1)
ON DUPLICATE KEY UPDATE
    `can_view` = VALUES(`can_view`),
    `can_manage` = VALUES(`can_manage`);

-- OPERARIO ya no ve ni gestiona vehículos residentes en Gestión.
INSERT INTO `role_nav_permissions`
    (`role_system`, `module_key`, `can_view`, `can_manage`)
VALUES
    ('OPERARIO', 'vehicles', 0, 0)
ON DUPLICATE KEY UPDATE
    `can_view` = VALUES(`can_view`),
    `can_manage` = VALUES(`can_manage`);
