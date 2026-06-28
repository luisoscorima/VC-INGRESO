<?php

namespace Controllers;

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';

use Utils\Response;

class NavPermissionsController extends Controller
{
    /**
     * GET /api/v1/config/nav-permissions
     * Permisos resueltos para el usuario en sesión.
     */
    public function resolveForSession(): void
    {
        $auth = requireAuth();
        $modules = getResolvedNavPermissions($this->db, $auth);
        Response::success(['modules' => $modules]);
    }

    /**
     * GET /api/v1/admin/nav-permissions
     * Matriz completa para edición (solo administrador).
     */
    public function adminMatrix(): void
    {
        $auth = requireAuth();
        if (!isAdminRole($auth)) {
            Response::error('Solo administradores pueden gestionar permisos', 403);

            return;
        }
        Response::success(getAdminNavMatrix($this->db));
    }

    /**
     * PUT /api/v1/admin/nav-permissions
     * Guarda toggles globales y matriz rol × módulo.
     */
    public function adminUpdate(): void
    {
        $auth = requireAuth();
        if (!isAdminRole($auth)) {
            Response::error('Solo administradores pueden gestionar permisos', 403);

            return;
        }
        $data = $this->getInput();
        if (empty($data)) {
            Response::error('No hay datos para guardar', 400);

            return;
        }
        saveAdminNavMatrix($this->db, $data);
        Response::success(getAdminNavMatrix($this->db), 'Permisos actualizados');
    }
}
