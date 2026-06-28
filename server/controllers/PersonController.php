<?php
/**
 * PersonController para VC-INGRESO
 * 
 * Controlador para gestionar personas (residentes, visitantes, trabajadores, etc.)
 * del sistema de control de acceso del condominio.
 * 
 * Estados de validacion:
 * - PERMITIDO: Puede acceder normalmente
 * - DENEGADO: No puede acceder
 * - OBSERVADO: Requiere atencion especial
 * 
 * Tipos de persona (`persons.person_type`):
 * - PROPIETARIO, RESIDENTE, INQUILINO: pueden tener usuario (`USUARIO`) según reglas de negocio
 * - INVITADO: persona en el padrón del hogar sin cuenta de sistema (no fila en `users`)
 * - VISITA_TEMPORAL: uso en accesos (no confundir con INVITADO)
 * Staff sin casa: `role_system` OPERARIO/ADMINISTRADOR y `person_type` NULL
 */

namespace Controllers;

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/event_log.php';

use Utils\Response;

class PersonController extends Controller {
    protected $tableName = 'persons';  // Tabla renombrada de 'clients'

    /**
     * Listar personas. USUARIO: solo vínculos a sus casas. Admin/operario: listado completo.
     * Query: without_user=1 → solo sin usuario (staff: consulta; alta/edición sigue solo administración en UI/API).
     */
    public function index($params = []) {
        $auth = requireAuth();
        $withoutUser = isset($params['without_user']) && ($params['without_user'] === '1' || $params['without_user'] === true);
        if ($withoutUser) {
            if (!isStaffRole($auth)) {
                Response::error('Sin permiso', 403);
                return;
            }
            $sql = "SELECT p.* FROM {$this->tableName} p
                    LEFT JOIN users u ON u.person_id = p.id
                    WHERE u.user_id IS NULL
                    ORDER BY p.id DESC";
            $stmt = $this->db->query($sql);
            $persons = $stmt->fetchAll();
            Response::success($persons, 'Personas obtenidas correctamente');
            return;
        }

        $role = strtoupper(trim($auth['role_system'] ?? ''));
        if ($role === 'USUARIO') {
            $ids = getAccessibleHouseIds($this->db, $auth);
            if (empty($ids)) {
                Response::success([], 'Personas obtenidas correctamente');
                return;
            }
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $sql = "SELECT DISTINCT p.* FROM {$this->tableName} p
                    WHERE p.house_id IN ($placeholders)
                       OR EXISTS (
                            SELECT 1 FROM house_members hm
                            WHERE hm.person_id = p.id AND hm.house_id IN ($placeholders)
                              AND COALESCE(hm.is_active, 1) = 1
                        )
                    ORDER BY p.id DESC";
            $stmt = $this->db->prepare($sql);
            $stmt->execute(array_merge($ids, $ids));
            $persons = $stmt->fetchAll();
        } else {
            $persons = $this->getAll([], 'id DESC');
        }
        Response::success($persons, 'Personas obtenidas correctamente');
    }
    
    /**
     * Obtener persona por ID
     */
    public function show($params = []) {
        $auth = requireAuth();
        $id = $params['id'] ?? null;
        
        if (!$id) {
            Response::error('ID de persona requerido', 400);
        }
        
        $person = $this->findById($id, 'id');
        
        if (!$person) {
            Response::notFound('Persona no encontrada');
        }
        if (!canAccessPersonRecord($this->db, $auth, $person)) {
            Response::error('Persona no encontrada', 404);
            return;
        }
        
        Response::success($person);
    }
    
    /**
     * Obtener persona por numero de documento
     */
    public function byDocNumber($params = []) {
        $auth = requireAuth();
        $docNumber = $params['doc_number'] ?? null;
        
        if (!$docNumber) {
            Response::error('Numero de documento requerido', 400);
        }
        
        $sql = "SELECT * FROM {$this->tableName} WHERE doc_number = ? LIMIT 1";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$docNumber]);
        
        $person = $stmt->fetch();
        
        if (!$person) {
            Response::notFound('Persona no encontrada');
        }
        if (!canAccessPersonRecord($this->db, $auth, $person)) {
            Response::error('Persona no encontrada', 404);
            return;
        }
        
        Response::success($person);
    }
    
    /**
     * GET persons?fecha_cumple=MM-DD - Listar personas por cumpleaños (reemplazo getAll.php legacy)
     */
    public function listByBirthday($params = []) {
        $auth = requireAuth();
        $fecha_cumple = $params['fecha_cumple'] ?? $_GET['fecha_cumple'] ?? '';
        if ($fecha_cumple === '') {
            Response::error('fecha_cumple requerido', 400);
            return;
        }
        if (!preg_match('/^[0-9\-\/]{1,10}$/', $fecha_cumple)) {
            Response::error('fecha_cumple inválido', 400);
            return;
        }
        $role = strtoupper(trim($auth['role_system'] ?? ''));
        if ($role === 'USUARIO') {
            $ids = getAccessibleHouseIds($this->db, $auth);
            if (empty($ids)) {
                Response::success([]);
                return;
            }
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $sql = "SELECT p.*, h.block_house, h.lot, h.apartment FROM {$this->tableName} p
                    LEFT JOIN houses h ON p.house_id = h.house_id
                    WHERE p.birth_date LIKE ?
                      AND (p.house_id IN ($placeholders)
                       OR EXISTS (
                            SELECT 1 FROM house_members hm
                            WHERE hm.person_id = p.id AND hm.house_id IN ($placeholders)
                              AND COALESCE(hm.is_active, 1) = 1
                        ))
                    ORDER BY p.paternal_surname";
            $stmt = $this->db->prepare($sql);
            $stmt->execute(array_merge(["%{$fecha_cumple}%"], $ids, $ids));
        } else {
            $sql = "SELECT p.*, h.block_house, h.lot, h.apartment FROM {$this->tableName} p LEFT JOIN houses h ON p.house_id = h.house_id WHERE p.birth_date LIKE ? ORDER BY p.paternal_surname";
            $stmt = $this->db->prepare($sql);
            $stmt->execute(["%{$fecha_cumple}%"]);
        }
        $persons = $stmt->fetchAll(\PDO::FETCH_OBJ);
        Response::success($persons);
    }

    /**
     * GET persons/destacados - Stub / personas permitidas (reemplazo getDestacados legacy)
     */
    public function destacados($params = []) {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::error('Sin permiso', 403);
            return;
        }
        $sql = "SELECT p.*, h.block_house, h.lot FROM {$this->tableName} p LEFT JOIN houses h ON p.house_id = h.house_id WHERE p.status_validated = 'PERMITIDO' ORDER BY p.id DESC LIMIT 100";
        $stmt = $this->db->query($sql);
        Response::json($stmt->fetchAll(\PDO::FETCH_OBJ));
    }

    /**
     * Listar personas observadas (estado OBSERVADO)
     */
    public function observed($params = []) {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::error('Sin permiso', 403);
            return;
        }
        $sql = "SELECT * FROM {$this->tableName} WHERE status_validated = 'OBSERVADO' ORDER BY id DESC";
        $stmt = $this->db->query($sql);
        $persons = $stmt->fetchAll();
        
        Response::success($persons, 'Personas observadas obtenidas');
    }
    
    /**
     * Listar personas restringidas (estado DENEGADO)
     */
    public function restricted($params = []) {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::error('Sin permiso', 403);
            return;
        }
        $sql = "SELECT * FROM {$this->tableName} WHERE status_validated = 'DENEGADO' ORDER BY id DESC";
        $stmt = $this->db->query($sql);
        $persons = $stmt->fetchAll();
        
        Response::success($persons, 'Personas restringidas obtenidas');
    }
    
    /**
     * Crear nueva persona
     */
    public function store($params = []) {
        $auth = requireAuth();
        $data = $this->getInput();
        
        // Validar campos requeridos
        $required = ['doc_number', 'first_name', 'paternal_surname'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                Response::error("Campo requerido faltante: $field", 400);
            }
        }
        
        // Verificar si ya existe
        if ($this->exists('doc_number', $data['doc_number'])) {
            Response::error('Ya existe una persona con este documento', 409);
        }
        
        // Campos permitidos
        $allowed = [
            'type_doc', 'doc_number', 'first_name', 'paternal_surname', 'maternal_surname',
            'gender', 'birth_date', 'cel_number', 'email', 'address', 'district',
            'province', 'region', 'status_validated', 'status_reason', 'status_system',
            'person_type', 'house_id', 'photo_url', 'origin_list', 'motivo',
            'sala_list', 'fecha_list', 'fecha_registro', 'sala_registro', 'condicion'
        ];
        
        $filtered = [];
        foreach ($allowed as $field) {
            if (isset($data[$field])) {
                $filtered[$field] = $data[$field];
            }
        }

        $role = strtoupper(trim($auth['role_system'] ?? ''));
        $requestedType = isset($filtered['person_type']) ? strtoupper(trim((string) $filtered['person_type'])) : 'RESIDENTE';
        if ($requestedType === '') {
            $requestedType = 'RESIDENTE';
        }

        $vecinoMiCasa = ($role === 'USUARIO')
            || ($role === 'OPERARIO' && rpPersonTypeFromAuth($this->db, $auth) !== null);

        if ($vecinoMiCasa) {
            $hid = isset($filtered['house_id']) ? (int) $filtered['house_id'] : 0;
            if ($hid <= 0) {
                Response::error('Debe indicar house_id para registrar la persona', 400);
                return;
            }
            if (!canUsuarioCreatePersonForHouse($this->db, $auth, $hid, $requestedType)) {
                Response::error('Sin permiso para crear este tipo de persona en esta casa', 403);
                return;
            }
            $filtered['person_type'] = $requestedType;
            $filtered['status_validated'] = 'PERMITIDO';
            $filtered['status_system'] = 'ACTIVO';
            unset($filtered['status_reason'], $filtered['origin_list'], $filtered['motivo'], $filtered['sala_list'], $filtered['fecha_list'], $filtered['fecha_registro'], $filtered['sala_registro'], $filtered['condicion']);
        } elseif (isAdminRole($auth)) {
            // Solo administrador: altas desde gestión global (no operario de portería).
        } else {
            Response::error('Sin permiso para crear personas', 403);
            return;
        }
        
        // Estado por defecto (staff u omisiones)
        if (!isset($filtered['status_validated'])) {
            $filtered['status_validated'] = 'PERMITIDO';
        }
        
        $id = $this->create($filtered);
        $person = $this->findById($id, 'id');

        // Sincronizar con house_members (source de verdad house-centric), si aplica.
        if (!empty($filtered['house_id'])) {
            $relation = isset($filtered['person_type']) && trim($filtered['person_type']) !== ''
                ? strtoupper(trim($filtered['person_type']))
                : 'RESIDENTE';
            $stmt = $this->db->prepare("INSERT IGNORE INTO house_members (house_id, person_id, relation_type, is_active, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, 0, NOW(), NOW())");
            $stmt->execute([(int)$filtered['house_id'], (int)$id, $relation]);
        }
        
        recordEventLog($this->db, $auth, 'person.create', [
            'summary' => 'Persona creada: ' . ($person->first_name ?? '') . ' ' . ($person->paternal_surname ?? ''),
            'entity_type' => 'persons',
            'entity_id' => $id,
        ]);
        Response::created($person, 'Persona creada correctamente');
    }
    
    /**
     * Actualizar persona
     */
    public function updatePerson($params = []) {
        $auth = requireAuth();
        $id = $params['id'] ?? null;
        
        if (!$id) {
            Response::error('ID de persona requerido', 400);
        }
        
        $person = $this->findById($id, 'id');
        if (!$person) {
            Response::notFound('Persona no encontrada');
        }

        $role = strtoupper(trim($auth['role_system'] ?? ''));
        $vecinoMiCasa = ($role === 'USUARIO')
            || ($role === 'OPERARIO' && rpPersonTypeFromAuth($this->db, $auth) !== null);

        if (!isAdminRole($auth) && !$vecinoMiCasa) {
            Response::error('Sin permiso para editar personas', 403);
            return;
        }

        if (!canAccessPersonRecord($this->db, $auth, $person)) {
            Response::error('Persona no encontrada', 404);
            return;
        }

        if ($vecinoMiCasa) {
            $hid = resolvePersonHouseIdForPerson($this->db, (int) $id);
            if ($hid <= 0 || !canNeighborEditPersonInHouse($this->db, $auth, $person, $hid)) {
                Response::error('Sin permiso para editar esta persona', 403);
                return;
            }
        }

        $data = $this->getInput();
        
        // Campos permitidos
        $allowed = [
            'type_doc', 'doc_number', 'first_name', 'paternal_surname', 'maternal_surname',
            'gender', 'birth_date', 'cel_number', 'email', 'address', 'district',
            'province', 'region', 'status_validated', 'status_reason', 'status_system',
            'person_type', 'house_id', 'photo_url', 'origin_list', 'motivo',
            'sala_list', 'fecha_list'
        ];
        
        $filtered = [];
        foreach ($allowed as $field) {
            if (isset($data[$field])) {
                $filtered[$field] = $data[$field];
            }
        }

        if ($vecinoMiCasa) {
            foreach (['status_validated', 'status_reason', 'status_system', 'person_type', 'house_id', 'doc_number', 'type_doc'] as $priv) {
                unset($filtered[$priv]);
            }
        }
        
        if (empty($filtered)) {
            Response::error('No hay datos para actualizar', 400);
        }
        
        parent::update($id, $filtered, 'id');
        $person = $this->findById($id, 'id');

        recordEventLog($this->db, $auth, 'person.update', [
            'summary' => 'Persona actualizada #' . $id,
            'entity_type' => 'persons',
            'entity_id' => $id,
        ]);
        Response::success($person, 'Persona actualizada correctamente');
    }
    
    /**
     * Cambiar estado de validacion de una persona
     * POST /api/v1/persons/:id/validate
     */
    public function validate($params = []) {
        $auth = requireAuth();
        if (!isStaffRole($auth)) {
            Response::error('Sin permiso', 403);
            return;
        }
        $id = $params['id'] ?? null;
        
        if (!$id) {
            Response::error('ID de persona requerido', 400);
        }
        
        $person = $this->findById($id, 'id');
        if (!$person) {
            Response::notFound('Persona no encontrada');
        }
        
        $data = $this->getInput();
        
        if (!isset($data['status_validated'])) {
            Response::error('Estado de validacion requerido', 400);
        }
        
        $validStatuses = ['PERMITIDO', 'DENEGADO', 'OBSERVADO'];
        if (!in_array($data['status_validated'], $validStatuses)) {
            Response::error('Estado invalido. Valores permitidos: PERMITIDO, DENEGADO, OBSERVADO', 400);
        }
        
        parent::update($id, [
            'status_validated' => $data['status_validated'],
            'status_reason' => $data['status_reason'] ?? null
        ], 'id');
        
        $person = $this->findById($id, 'id');
        recordEventLog($this->db, $auth, 'person.validate', [
            'summary' => 'Estado de persona #' . $id . ' → ' . $data['status_validated'],
            'entity_type' => 'persons',
            'entity_id' => $id,
        ]);
        Response::success($person, 'Estado de validacion actualizado');
    }
    
    /**
     * Eliminar persona
     */
    public function destroy($params = []) {
        $auth = requireAuth();
        if (!isAdminRole($auth)) {
            Response::error('Solo administradores pueden eliminar personas', 403);
            return;
        }
        $id = $params['id'] ?? null;
        
        if (!$id) {
            Response::error('ID de persona requerido', 400);
        }
        
        $person = $this->findById($id, 'id');
        if (!$person) {
            Response::notFound('Persona no encontrada');
        }
        
        $this->delete($id, 'id');

        recordEventLog($this->db, $auth, 'person.delete', [
            'summary' => 'Persona eliminada #' . $id,
            'entity_type' => 'persons',
            'entity_id' => $id,
        ]);
        Response::success(null, 'Persona eliminada correctamente');
    }
}
