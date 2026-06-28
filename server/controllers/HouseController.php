<?php
/**
 * HouseController para VC-INGRESO
 * 
 * Controlador para gestionar las casas/lotes del conjunto residencial.
 */

namespace Controllers;

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';

use Utils\Response;

class HouseController extends Controller {
    protected $tableName = 'houses';
    
    /**
     * Listar casas. Solo administración ve todas; el resto solo las vinculadas a su persona.
     */
    public function index($params = []) {
        $auth = requireAuth();
        $ownerExistsSql = "(EXISTS (SELECT 1 FROM persons p WHERE p.house_id = h.house_id AND p.person_type = 'PROPIETARIO')) AS owner_registered";

        if (isStaffRole($auth)) {
            if (!canViewModule($this->db, $auth, 'houses')) {
                Response::error('Sin permiso', 403);
                return;
            }
            $sql = "SELECT h.*, {$ownerExistsSql} FROM {$this->tableName} h ORDER BY h.house_id DESC";
            $stmt = $this->db->query($sql);
            $houses = $stmt->fetchAll(\PDO::FETCH_OBJ);
            Response::success($houses, 'Casas obtenidas correctamente');
            return;
        }
        $ids = getAccessibleHouseIds($this->db, $auth);
        if (empty($ids)) {
            Response::success([], 'Casas obtenidas correctamente');
            return;
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->db->prepare("SELECT h.*, {$ownerExistsSql} FROM {$this->tableName} h WHERE h.house_id IN ($placeholders) ORDER BY h.house_id DESC");
        $stmt->execute($ids);
        $houses = $stmt->fetchAll(\PDO::FETCH_OBJ);
        Response::success($houses, 'Casas obtenidas correctamente');
    }

    /**
     * Obtener casa por ID
     */
    public function show($params = []) {
        $auth = requireAuth();
        $houseId = $params['id'] ?? null;

        if (!$houseId) {
            Response::error('ID de casa requerido', 400);
        }

        $house = $this->findById($houseId, 'house_id');
        
        if (!$house) {
            Response::notFound('Casa no encontrada');
        }
        if (!canAccessHouse($this->db, $auth, (int) $houseId)) {
            Response::error('Sin permiso para ver esta casa', 403);
            return;
        }
        
        Response::success($house);
    }

    /**
     * GET houses/:id/members - Miembros de la casa (fuente: house_members + persons)
     * Reemplazo conceptual de getPersonsByHouseId (que devolvía users).
     */
    public function members($params = []) {
        $auth = requireAuth();
        $houseId = $params['id'] ?? null;
        if (!$houseId) {
            Response::error('ID de casa requerido', 400);
        }
        if (!canAccessHouse($this->db, $auth, (int) $houseId)) {
            Response::error('Sin permiso para ver miembros de esta casa', 403);
            return;
        }
        $house = $this->findById($houseId, 'house_id');
        if (!$house) {
            Response::notFound('Casa no encontrada');
        }

        $stmt = $this->db->prepare("
            SELECT hm.id AS membership_id, hm.relation_type, hm.is_primary, hm.is_active, hm.start_date, hm.end_date,
                   p.id AS person_id, p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname,
                   p.gender, p.birth_date, p.cel_number, p.email, p.person_type, p.status_validated, p.status_system, p.photo_url
            FROM house_members hm
            JOIN persons p ON p.id = hm.person_id
            WHERE hm.house_id = ? AND hm.is_active = 1
            ORDER BY hm.is_primary DESC, hm.relation_type, p.paternal_surname, p.first_name
        ");
        $stmt->execute([$houseId]);
        $members = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        // Añadir personas asignadas a la casa que no están en house_members
        $memberIds = array_column($members, 'person_id');
        $query = "SELECT NULL AS membership_id, p.person_type AS relation_type, 0 AS is_primary, 1 AS is_active, NULL AS start_date, NULL AS end_date,
                         p.id AS person_id, p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname,
                         p.gender, p.birth_date, p.cel_number, p.email, p.person_type, p.status_validated, p.status_system, p.photo_url
                  FROM persons p
                  WHERE p.house_id = ?";

        $params = [$houseId];
        if (!empty($memberIds)) {
            $placeholders = implode(',', array_fill(0, count($memberIds), '?'));
            $query .= " AND p.id NOT IN ($placeholders)";
            $params = array_merge($params, $memberIds);
        }

        $query .= " ORDER BY p.paternal_surname, p.first_name";

        $stmt2 = $this->db->prepare($query);
        $stmt2->execute($params);
        $extra = $stmt2->fetchAll(\PDO::FETCH_ASSOC);

        $members = array_merge($members, $extra);

        Response::success($members, 'Miembros obtenidos correctamente');
    }
    
    /**
     * Crear nueva casa
     */
    public function store($params = []) {
        $auth = requireAuth();
        if (!canManageModule($this->db, $auth, 'houses')) {
            Response::error('Solo administradores pueden crear casas', 403);
            return;
        }
        $data = $this->getInput();
        
        // Validar campos requeridos
        $required = ['house_type', 'block_house', 'status_system'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                Response::error("Campo requerido faltante: $field", 400);
            }
        }

        // Campos permitidos
        $allowed = ['house_type', 'block_house', 'lot', 'apartment', 'status_system'];
        
        $filtered = [];
        foreach ($allowed as $field) {
            if (isset($data[$field])) {
                $filtered[$field] = $data[$field];
            }
        }
        
        $houseId = $this->create($filtered);
        $house = $this->findById($houseId, 'house_id');

        Response::created($house, 'Casa creada correctamente');
    }
    
    /**
     * Actualizar casa
     */
    public function updateHouse($params = []) {
        $auth = requireAuth();
        if (!canManageModule($this->db, $auth, 'houses')) {
            Response::error('Solo administradores pueden editar casas', 403);
            return;
        }
        $houseId = $params['id'] ?? null;
        
        if (!$houseId) {
            Response::error('ID de casa requerido', 400);
        }
        
        $house = $this->findById($houseId, 'house_id');
        if (!$house) {
            Response::notFound('Casa no encontrada');
        }

        $data = $this->getInput();

        // Campos permitidos
        $allowed = ['house_type', 'block_house', 'lot', 'apartment', 'status_system'];

        $filtered = [];
        foreach ($allowed as $field) {
            if (isset($data[$field])) {
                $filtered[$field] = $data[$field];
            }
        }

        if (empty($filtered)) {
            Response::error('No hay datos para actualizar', 400);
        }

        parent::update($houseId, $filtered, 'house_id');
        $house = $this->findById($houseId, 'house_id');
        
        Response::success($house, 'Casa actualizada correctamente');
    }
    
    /**
     * Eliminar casa
     */
    public function destroy($params = []) {
        $auth = requireAuth();
        if (!canManageModule($this->db, $auth, 'houses')) {
            Response::error('Solo administradores pueden eliminar casas', 403);
            return;
        }
        $houseId = $params['id'] ?? null;
        
        if (!$houseId) {
            Response::error('ID de casa requerido', 400);
        }
        
        $house = $this->findById($houseId, 'house_id');
        if (!$house) {
            Response::notFound('Casa no encontrada');
        }

        $this->delete($houseId, 'house_id');
        
        Response::success(null, 'Casa eliminada correctamente');
    }
}
