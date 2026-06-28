-- Corrige etiquetas con mojibake (p. ej. VehÃculos) si la migración 001 se ejecutó sin UTF-8.
-- Ejecutar: docker exec -i vc-ingreso-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" vc_db' < database/migrations/002_fix_nav_module_labels.sql

SET NAMES utf8mb4;

UPDATE `nav_modules` SET `label` = 'Usuarios' WHERE `module_key` = 'users';
UPDATE `nav_modules` SET `label` = 'Viviendas' WHERE `module_key` = 'houses';
UPDATE `nav_modules` SET `label` = 'Vehículos' WHERE `module_key` = 'vehicles';
UPDATE `nav_modules` SET `label` = 'Mascotas' WHERE `module_key` = 'pets';
UPDATE `nav_modules` SET `label` = 'Comunicados' WHERE `module_key` = 'announcements';
UPDATE `nav_modules` SET `label` = 'Encuestas' WHERE `module_key` = 'surveys';
UPDATE `nav_modules` SET `label` = 'Puntos de acceso' WHERE `module_key` = 'access_points';
