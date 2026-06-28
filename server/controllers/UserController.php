<?php
/**
 * UserController para VC-INGRESO
 * 
 * Controlador para gestionar usuarios del sistema.
 * Ejemplo de implementación MVC.
 */

namespace Controllers;

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';

use Utils\Response;
use Utils\Router;

class UserController extends Controller {
    protected $tableName = 'users';
    
    /**
     * Listar todos los usuarios (datos sistema en users + identidad en persons)
     * Solo personal autorizado (admin / operario).
     */
    public function index($params = []) {
        $auth = requireAuth();
        if (!canViewModule($this->db, $auth, 'users')) {
            Response::error('Sin permiso', 403);
            return;
        }
        $sql = "SELECT u.user_id, u.person_id, u.role_system, u.username_system, u.house_id,
                       u.status_validated, u.status_reason, u.status_system, u.is_active, u.force_password_change,
                       p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname,
                       p.gender, p.birth_date, p.cel_number, p.email, p.photo_url, p.civil_status,
                       p.person_type AS property_category,
                       p.address, p.district, p.province, p.region,
                       h.block_house, h.lot, h.apartment
                FROM users u
                LEFT JOIN persons p ON u.person_id = p.id
                LEFT JOIN houses h ON h.house_id = COALESCE(u.house_id, p.house_id,
                    (SELECT house_id FROM house_members hm WHERE hm.person_id = p.id AND COALESCE(hm.is_active,1) = 1
                     ORDER BY hm.is_primary DESC, hm.id ASC LIMIT 1))
                ORDER BY u.user_id DESC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute();
        $users = $stmt->fetchAll(\PDO::FETCH_OBJ);
        foreach ($users as $u) {
            unset($u->password_system);
        }
        if (strtoupper(trim($auth['role_system'] ?? '')) === 'OPERARIO') {
            foreach ($users as $u) {
                unset($u->type_doc, $u->doc_number);
            }
        }
        Response::success($users, 'Usuarios obtenidos correctamente');
    }
    
    /**
     * Obtener usuario por ID (datos sistema + persona enlazada)
     */
    public function show($params = []) {
        $auth = requireAuth();
        $userId = $params['id'] ?? null;
        
        if (!$userId) {
            Response::error('ID de usuario requerido', 400);
        }
        
        $sql = "SELECT u.user_id, u.person_id, u.role_system, u.username_system, u.house_id,
                       u.status_validated, u.status_reason, u.status_system, u.is_active, u.force_password_change,
                       p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname,
                       p.gender, p.birth_date, p.cel_number, p.email, p.photo_url, p.civil_status,
                       p.person_type AS property_category,
                       p.address, p.district, p.province, p.region,
                       h.block_house, h.lot, h.apartment
                FROM users u
                LEFT JOIN persons p ON u.person_id = p.id
                LEFT JOIN houses h ON h.house_id = COALESCE(u.house_id, p.house_id,
                    (SELECT house_id FROM house_members hm WHERE hm.person_id = p.id AND COALESCE(hm.is_active,1) = 1
                     ORDER BY hm.is_primary DESC, hm.id ASC LIMIT 1))
                WHERE u.user_id = ? LIMIT 1";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$userId]);
        $user = $stmt->fetch(\PDO::FETCH_OBJ);
        
        if (!$user) {
            Response::notFound('Usuario no encontrado');
        }
        if (!canManageUserRecord($this->db, $auth, $user)) {
            Response::error('Usuario no encontrado', 404);
            return;
        }

        // Añadir block_house, lot, apartment de la vivienda principal (side-nav / nav-bar).
        $houseId = !empty($user->house_id) ? (int) $user->house_id : null;
        if (!$houseId && !empty($user->person_id)) {
            $stmtHm = $this->db->prepare("SELECT house_id FROM house_members WHERE person_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY is_primary DESC, id ASC LIMIT 1");
            $stmtHm->execute([$user->person_id]);
            $row = $stmtHm->fetch(\PDO::FETCH_OBJ);
            $houseId = $row ? (int) $row->house_id : null;

            if (!$houseId) {
                $stmtP = $this->db->prepare("SELECT house_id FROM persons WHERE id = ? LIMIT 1");
                $stmtP->execute([$user->person_id]);
                $personRow = $stmtP->fetch(\PDO::FETCH_ASSOC);
                if ($personRow && !empty($personRow['house_id'])) {
                    $houseId = (int) $personRow['house_id'];
                }
            }
        }
        if ($houseId) {
            $stmtH = $this->db->prepare("SELECT block_house, lot, apartment FROM houses WHERE house_id = ? LIMIT 1");
            $stmtH->execute([$houseId]);
            $h = $stmtH->fetch(\PDO::FETCH_OBJ);
            if ($h) {
                $user->block_house = $h->block_house;
                $user->lot = $h->lot;
                $user->apartment = $h->apartment;
            }
            // Asegurar que el usuario devuelto tenga la casa principal correcta
            $user->house_id = (int) $houseId;
        }
        if (strtoupper(trim($auth['role_system'] ?? '')) === 'OPERARIO') {
            unset($user->type_doc, $user->doc_number);
        }

        Response::success($user);
    }
    
    /**
     * Crear nuevo usuario. Crea/usa persona (datos civiles) y usuario (sistema).
     * Solo administración / operario (no vecinos; ellos usan persons + from-person).
     */
    public function store($params = []) {
        $auth = requireAuth();
        if (!canManageModule($this->db, $auth, 'users')) {
            Response::error('Solo administradores pueden crear usuarios', 403);
            return;
        }
        $data = $this->getInput();
        
        $required = ['doc_number', 'first_name', 'paternal_surname'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                Response::error("Campo requerido faltante: $field", 400);
            }
        }
        
        $stmt = $this->db->prepare("SELECT id FROM persons WHERE doc_number = ? LIMIT 1");
        $stmt->execute([trim($data['doc_number'])]);
        $existingPerson = $stmt->fetch(\PDO::FETCH_OBJ);
        if ($existingPerson) {
            $stmt = $this->db->prepare("SELECT 1 FROM users WHERE person_id = ? LIMIT 1");
            $stmt->execute([$existingPerson->id]);
            if ($stmt->fetch()) {
                Response::error('Ya existe un usuario con este número de documento', 409);
            }
        }
        
        $personAllowed = ['type_doc', 'doc_number', 'first_name', 'paternal_surname', 'maternal_surname', 'gender', 'birth_date', 'cel_number', 'email', 'address', 'district', 'province', 'region', 'civil_status', 'photo_url', 'person_type', 'property_category', 'house_id', 'status_validated', 'status_system'];
        $userAllowed = ['role_system', 'username_system', 'password_system', 'house_id', 'status_validated', 'status_reason', 'status_system', 'force_password_change'];

        $roleSystem = strtoupper(trim((string) ($data['role_system'] ?? 'USUARIO')));
        $houseIdCreate = isset($data['house_id']) && $data['house_id'] !== '' && $data['house_id'] !== null
            ? (int) $data['house_id'] : 0;
        $staffWithoutHouse = in_array($roleSystem, ['OPERARIO', 'ADMINISTRADOR'], true) && $houseIdCreate <= 0;
        
        if ($existingPerson) {
            $personId = (int) $existingPerson->id;
        } else {
            $pData = [];
            foreach ($personAllowed as $f) {
                if (isset($data[$f])) $pData[$f] = $data[$f];
            }
            if (isset($pData['property_category']) && (!isset($pData['person_type']) || trim((string)$pData['person_type']) === '')) {
                $pData['person_type'] = $pData['property_category'];
            }
            unset($pData['property_category']);
            $personTypeEmpty = !isset($pData['person_type'])
                || trim((string) $pData['person_type']) === '';
            if ($personTypeEmpty) {
                $pData['person_type'] = $staffWithoutHouse ? null : 'RESIDENTE';
            }
            $cols = implode(', ', array_keys($pData));
            $ph = implode(', ', array_fill(0, count($pData), '?'));
            $this->db->prepare("INSERT INTO persons ($cols) VALUES ($ph)")->execute(array_values($pData));
            $personId = (int) $this->db->lastInsertId();
        }

        $stmtPt = $this->db->prepare('SELECT person_type FROM persons WHERE id = ? LIMIT 1');
        $stmtPt->execute([$personId]);
        $rowPt = $stmtPt->fetch(\PDO::FETCH_ASSOC);
        if ($rowPt && strtoupper(trim((string) ($rowPt['person_type'] ?? ''))) === 'INVITADO') {
            Response::error(
                'No se puede crear usuario para una persona INVITADO. Cambie primero el tipo a PROPIETARIO, RESIDENTE o INQUILINO.',
                400
            );

            return;
        }

        $uData = ['person_id' => $personId];
        foreach ($userAllowed as $f) {
            if (isset($data[$f])) $uData[$f] = $data[$f];
        }
        $uData['force_password_change'] = isset($data['force_password_change'])
            ? ((int) $data['force_password_change'] ? 1 : 0)
            : 1;
        if (isset($uData['password_system']) && $uData['password_system'] !== '') {
            $uData['password_system'] = password_hash($uData['password_system'], PASSWORD_DEFAULT);
        }
        if (empty($uData['role_system'])) {
            $uData['role_system'] = 'USUARIO';
        }
        $roleCheck = strtoupper(trim((string) $uData['role_system']));
        if (!in_array($roleCheck, ['USUARIO', 'OPERARIO', 'ADMINISTRADOR'], true)) {
            Response::error('Rol no válido. Use USUARIO, OPERARIO o ADMINISTRADOR.', 400);

            return;
        }
        $uData['role_system'] = $roleCheck;
        if (empty($uData['username_system'])) {
            $uData['username_system'] = trim($data['doc_number']);
        }
        $stmtPair = $this->db->prepare('SELECT UPPER(TRIM(COALESCE(person_type,\'\'))) AS pt FROM persons WHERE id = ? LIMIT 1');
        $stmtPair->execute([$personId]);
        $rowPair = $stmtPair->fetch(\PDO::FETCH_ASSOC);
        $pairPt = rpNormalizePersonType($rowPair['pt'] ?? null);
        if (!isValidRolePersonPair((string) $uData['role_system'], $pairPt)) {
            Response::error('Combinación de rol de sistema y tipo de persona no permitida', 400);

            return;
        }
        if ($this->exists('username_system', $uData['username_system'])) {
            Response::error('El nombre de usuario ya existe', 409);
        }
        $cols = implode(', ', array_keys($uData));
        $ph = implode(', ', array_fill(0, count($uData), '?'));
        $this->db->prepare("INSERT INTO users ($cols) VALUES ($ph)")->execute(array_values($uData));
        $userId = (int) $this->db->lastInsertId();
        
        $sql = "SELECT u.user_id, u.person_id, u.role_system, u.username_system, u.house_id, u.force_password_change,
                   u.status_validated, u.status_reason, u.status_system, u.is_active,
                   p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname, p.gender, p.birth_date, p.cel_number, p.email, p.photo_url, p.civil_status, p.person_type AS property_category, p.address, p.district, p.province, p.region
                FROM users u LEFT JOIN persons p ON u.person_id = p.id WHERE u.user_id = ? LIMIT 1";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$userId]);
        $user = $stmt->fetch(\PDO::FETCH_OBJ);
        Response::created($user, 'Usuario creado correctamente');
    }
    
    /**
     * Actualizar usuario: datos civiles en persons, datos sistema en users.
     */
    public function updateUser($params = []) {
        $auth = requireAuth();
        $userId = $params['id'] ?? null;
        if (!$userId) {
            Response::error('ID de usuario requerido', 400);
        }
        
        $user = $this->findById($userId, 'user_id');
        if (!$user) {
            Response::notFound('Usuario no encontrado');
        }
        if (!canManageUserRecord($this->db, $auth, $user)) {
            Response::error('Usuario no encontrado', 404);
            return;
        }
        if (!canManageModule($this->db, $auth, 'users')) {
            Response::error('Sin permiso para modificar usuarios', 403);
            return;
        }

        $data = $this->getInput();
        if (empty($data)) {
            Response::error('No hay datos para actualizar', 400);
        }
        if (!isStaffRole($auth)) {
            if (array_key_exists('role_system', $data)) {
                $r = strtoupper(trim((string) $data['role_system']));
                if ($r !== '' && $r !== 'USUARIO') {
                    unset($data['role_system']);
                }
            }
            unset($data['is_active']);
            if (array_key_exists('house_id', $data)) {
                $hid = (int) $data['house_id'];
                if ($hid > 0 && !canAccessHouse($this->db, $auth, $hid)) {
                    unset($data['house_id']);
                }
            }
        }
        
        $personAllowed = ['type_doc', 'doc_number', 'first_name', 'paternal_surname', 'maternal_surname', 'gender', 'birth_date', 'cel_number', 'email', 'address', 'district', 'province', 'region', 'civil_status', 'photo_url', 'person_type', 'property_category', 'house_id', 'status_validated', 'status_system'];
        $userAllowed = ['role_system', 'username_system', 'password_system', 'house_id', 'status_validated', 'status_reason', 'status_system', 'is_active', 'force_password_change'];
        
        if (!empty($user->person_id)) {
            $pData = [];
            foreach ($personAllowed as $f) {
                if (array_key_exists($f, $data)) $pData[$f] = $data[$f];
            }
            $hasPersonType = array_key_exists('person_type', $pData) && trim((string)$pData['person_type']) !== '';
            if (array_key_exists('property_category', $pData) && !$hasPersonType) {
                $pData['person_type'] = $pData['property_category'];
            }
            unset($pData['property_category']);
            if (!empty($pData)) {
                $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($pData)));
                $params = array_values($pData);
                $params[] = $user->person_id;
                $this->db->prepare("UPDATE persons SET $set WHERE id = ?")->execute($params);
            }
        }
        
        $uData = [];
        foreach ($userAllowed as $f) {
            if (array_key_exists($f, $data)) $uData[$f] = $data[$f];
        }
        if (isset($uData['password_system']) && $uData['password_system'] !== '') {
            $uData['password_system'] = password_hash($uData['password_system'], PASSWORD_DEFAULT);
            // Si el cliente pide forzar cambio en el próximo login (p. ej. restablecer a doc_number), no anular el flag.
            if (!array_key_exists('force_password_change', $data) || (int) ($data['force_password_change'] ?? 0) === 0) {
                $uData['force_password_change'] = 0;
            }
        }
        if (!empty($uData)) {
            parent::update($userId, $uData, 'user_id');
        }
        
        $sql = "SELECT u.user_id, u.person_id, u.role_system, u.username_system, u.house_id, u.status_validated, u.status_reason, u.status_system, u.is_active,
                   p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname, p.gender, p.birth_date, p.cel_number, p.email, p.photo_url, p.civil_status, p.person_type AS property_category, p.address, p.district, p.province, p.region
                FROM users u LEFT JOIN persons p ON u.person_id = p.id WHERE u.user_id = ? LIMIT 1";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$userId]);
        $user = $stmt->fetch(\PDO::FETCH_OBJ);
        Response::success($user, 'Usuario actualizado correctamente');
    }
    
    /**
     * GET /api/v1/users/check-username?username=
     * Comprobar si un nombre de usuario está libre (Mi casa / sugerencias sin listar todo el directorio).
     */
    public function checkUsernameAvailability($params = []) {
        requireAuth();
        $u = trim($_GET['username'] ?? $_GET['q'] ?? '');
        if ($u === '') {
            Response::error('username requerido', 400);
            return;
        }
        $taken = $this->exists('username_system', $u);
        Response::success(['available' => !$taken, 'username' => $u]);
    }

    /**
     * POST /api/v1/users/from-person
     * Crear usuario a partir de una persona existente (dar acceso al sistema).
    * Body: { person_id, username_system, password_system, role_system, force_password_change? }.
     * No se duplican datos de identidad en users; se obtienen de persons vía person_id.
     */
    public function createFromPerson($params = []) {
        $auth = requireAuth();
        $data = $this->getInput();
        $personId = isset($data['person_id']) ? (int) $data['person_id'] : null;
        if (!$personId) {
            Response::error('person_id es requerido', 400);
        }
        foreach (['username_system', 'password_system', 'role_system'] as $f) {
            if (empty($data[$f])) {
                Response::error("Campo requerido: $f", 400);
            }
        }
        $roleNorm = strtoupper(trim((string) $data['role_system']));
        $allowedRoles = ['USUARIO', 'OPERARIO', 'ADMINISTRADOR'];
        if (!in_array($roleNorm, $allowedRoles, true)) {
            Response::error('Rol no válido. Use USUARIO, OPERARIO o ADMINISTRADOR.', 400);

            return;
        }
        $data['role_system'] = $roleNorm;
        $stmt = $this->db->prepare('SELECT * FROM persons WHERE id = ? LIMIT 1');
        $stmt->execute([$personId]);
        $personRow = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$personRow) {
            Response::error('Persona no encontrada', 404);
        }
        $personTypeUpper = strtoupper(trim((string) ($personRow['person_type'] ?? '')));
        if ($personTypeUpper === 'INVITADO') {
            Response::error(
                'No se puede dar acceso al sistema a una persona con categoría INVITADO. Cambie primero el tipo a PROPIETARIO, RESIDENTE o INQUILINO.',
                400
            );

            return;
        }
        $pairPt = rpNormalizePersonType($personRow['person_type'] ?? null);
        if (!isValidRolePersonPair($roleNorm, $pairPt)) {
            Response::error('Combinación de rol de sistema y tipo de persona no permitida', 400);

            return;
        }
        if (!isStaffRole($auth)) {
            if (strtoupper(trim($auth['role_system'] ?? '')) !== 'USUARIO') {
                Response::error('Sin permiso', 403);
                return;
            }
            if (strtoupper(trim((string) $data['role_system'])) !== 'USUARIO') {
                Response::error('Solo puede asignar rol USUARIO', 400);
                return;
            }
            if (!canAccessPersonRecord($this->db, $auth, $personRow)) {
                Response::error('Sin permiso', 403);
                return;
            }
        }
        $stmt = $this->db->prepare("SELECT 1 FROM users WHERE person_id = ? LIMIT 1");
        $stmt->execute([$personId]);
        if ($stmt->fetch()) {
            Response::error('Esta persona ya tiene un usuario asignado', 409);
        }
        if ($this->exists('username_system', trim($data['username_system']))) {
            Response::error('El nombre de usuario ya existe', 409);
        }
        $houseId = null;
        $stmt = $this->db->prepare("SELECT house_id FROM house_members WHERE person_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY is_primary DESC, id ASC LIMIT 1");
        $stmt->execute([$personId]);
        $row = $stmt->fetch(\PDO::FETCH_OBJ);
        if ($row) {
            $houseId = (int) $row->house_id;
        }
        $insert = [
            'person_id' => $personId,
            'username_system' => trim($data['username_system']),
            'password_system' => password_hash($data['password_system'], PASSWORD_DEFAULT),
            'role_system' => trim($data['role_system']),
            'is_active' => 1,
            'force_password_change' => isset($data['force_password_change']) ? ((int)$data['force_password_change'] ? 1 : 0) : 1,
            'house_id' => $houseId,
            'status_validated' => 'PERMITIDO',
            'status_system' => 'ACTIVO'
        ];
        $cols = implode(', ', array_keys($insert));
        $placeholders = implode(', ', array_fill(0, count($insert), '?'));
        $sql = "INSERT INTO users ($cols) VALUES ($placeholders)";
        $stmt = $this->db->prepare($sql);
        $stmt->execute(array_values($insert));
        $userId = (int) $this->db->lastInsertId();
        $user = $this->findById($userId, 'user_id');
        unset($user->password_system);
        Response::created($user, 'Usuario creado; la persona ya puede iniciar sesión');
    }

    /**
     * GET /api/v1/users/by-doc-number?doc_number=
     * Obtener usuario por número de documento (person.doc_number).
     */
    public function byDocNumber($params = []) {
        $auth = requireAuth();
        $doc_number = $params['doc_number'] ?? $_GET['doc_number'] ?? '';
        if (empty($doc_number)) {
            Response::error('doc_number requerido', 400);
            return;
        }
        $sql = "SELECT u.user_id, u.person_id, u.role_system, u.username_system, u.house_id, u.force_password_change,
                       u.status_validated, u.status_reason, u.status_system,
                       p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname,
                       p.gender, p.birth_date, p.cel_number, p.email, p.photo_url, p.civil_status,
                       p.person_type AS property_category,
                       p.address, p.address AS address_reniec, p.district, p.province, p.region,
                       h.block_house, h.lot, h.apartment
                FROM users u
                LEFT JOIN persons p ON u.person_id = p.id
                LEFT JOIN houses h ON u.house_id = h.house_id
                WHERE p.doc_number = ? LIMIT 1";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$doc_number]);
        $user = $stmt->fetch(\PDO::FETCH_OBJ);
        if (!$user) {
            // No encontrado es un caso esperado en búsquedas previas a RENIEC;
            // devolvemos 200 con data vacía para evitar ruido en logs del frontend.
            Response::success((object) [], 'Usuario no encontrado');
            return;
        }
        if (isStaffRole($auth)) {
            Response::success($user);
            return;
        }
        if (canManageUserRecord($this->db, $auth, $user)) {
            Response::success($user);
            return;
        }
        Response::success((object) [], 'Usuario no encontrado');
    }

    /**
     * Obtener usuarios por fecha de cumpleaños (con domicilio: manzana/lote)
     */
    public function byBirthday($params = []) {
        $auth = requireAuth();
        $fecha_cumple = $params['fecha_cumple'] ?? $_GET['fecha_cumple'] ?? null;
        
        if (!$fecha_cumple) {
            Response::error('Parámetro fecha_cumple requerido', 400);
            return;
        }

        $baseSql = "SELECT u.user_id, u.person_id, u.role_system, u.username_system, u.house_id, u.status_validated, u.status_reason, u.status_system,
                       p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname,
                       p.gender, p.birth_date, p.cel_number, p.email, p.photo_url,
                       h.block_house, h.lot, h.apartment
                FROM users u
                LEFT JOIN persons p ON u.person_id = p.id
                LEFT JOIN houses h ON u.house_id = h.house_id
                WHERE p.id IS NOT NULL AND DATE_FORMAT(p.birth_date,'%m-%d') = ? AND u.status_validated = 'PERMITIDO'";

        if (isStaffRole($auth)) {
            $sql = $baseSql . ' ORDER BY p.paternal_surname, p.first_name';
            $stmt = $this->db->prepare($sql);
            $stmt->execute([$fecha_cumple]);
            Response::success($stmt->fetchAll(\PDO::FETCH_OBJ));
            return;
        }

        // Vecinos y demás roles no operativos: todo el condominio, solo datos para felicitar (sin año de nacimiento ni DNI).
        $sqlPublic = "SELECT
                p.first_name,
                p.paternal_surname,
                p.maternal_surname,
                CONCAT('2000-', DATE_FORMAT(p.birth_date, '%m-%d')) AS birth_date,
                p.cel_number,
                h.block_house,
                h.lot,
                h.apartment
            FROM users u
            INNER JOIN persons p ON u.person_id = p.id
            LEFT JOIN houses h ON h.house_id = COALESCE(
                u.house_id,
                p.house_id,
                (SELECT hm.house_id FROM house_members hm
                 WHERE hm.person_id = p.id AND COALESCE(hm.is_active, 1) = 1
                 ORDER BY hm.is_primary DESC, hm.id ASC LIMIT 1)
            )
            WHERE p.birth_date IS NOT NULL
              AND DATE_FORMAT(p.birth_date, '%m-%d') = ?
              AND u.status_validated = 'PERMITIDO'
            ORDER BY p.paternal_surname, p.first_name";
        $stmt = $this->db->prepare($sqlPublic);
        $stmt->execute([$fecha_cumple]);
        Response::success($stmt->fetchAll(\PDO::FETCH_OBJ));
    }

    /**
     * PUT /api/v1/users/me/person
     * Actualizar datos personales del usuario autenticado (solo campos permitidos de persons).
     * Cualquier usuario puede modificar: gender, birth_date, cel_number, email, address, district, province, region, civil_status.
     */
    public function updateMyPerson($params = []) {
        $payload = requireAuth();
        $userId = isset($payload['user_id']) ? (int) $payload['user_id'] : null;
        if (!$userId) {
            Response::error('Usuario no identificado', 401);
            return;
        }
        $user = $this->findById($userId, 'user_id');
        if (!$user || empty($user->person_id)) {
            Response::error('Usuario o persona no encontrada', 404);
            return;
        }
        $data = $this->getInput();
        if (!is_array($data)) {
            Response::error('Cuerpo de petición inválido', 400);
            return;
        }
        $allowed = ['gender', 'birth_date', 'cel_number', 'email', 'address', 'district', 'province', 'region', 'civil_status'];
        $pData = [];
        foreach ($allowed as $f) {
            if (array_key_exists($f, $data)) {
                $pData[$f] = $data[$f];
            }
        }
        if (empty($pData)) {
            Response::error('No hay datos permitidos para actualizar', 400);
            return;
        }
        $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($pData)));
        $params = array_values($pData);
        $params[] = $user->person_id;
        $this->db->prepare("UPDATE persons SET $set WHERE id = ?")->execute($params);
        $sql = "SELECT u.user_id, u.person_id, u.role_system, u.username_system, u.house_id, u.status_validated, u.status_reason, u.status_system, u.is_active,
                       p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname, p.gender, p.birth_date, p.cel_number, p.email, p.photo_url, p.civil_status, p.address, p.district, p.province, p.region
                FROM users u LEFT JOIN persons p ON u.person_id = p.id WHERE u.user_id = ? LIMIT 1";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$userId]);
        $updated = $stmt->fetch(\PDO::FETCH_OBJ);
        Response::success($updated, 'Datos personales actualizados');
    }

    /**
     * PUT /api/v1/users/me/password
     * Cambiar contraseña del usuario autenticado. Body: { current_password, new_password }.
     */
    public function changeMyPassword($params = []) {
        $payload = requireAuth();
        $userId = isset($payload['user_id']) ? (int) $payload['user_id'] : null;
        if (!$userId) {
            Response::error('Usuario no identificado', 401);
            return;
        }
        $data = $this->getInput();
        if (!is_array($data)) {
            Response::error('Cuerpo de petición inválido', 400);
            return;
        }
        $current = trim($data['current_password'] ?? '');
        $newPass = trim($data['new_password'] ?? '');
        if ($newPass === '') {
            Response::error('Se requiere nueva contraseña', 400);
            return;
        }
        if (strlen($newPass) < 6) {
            Response::error('La nueva contraseña debe tener al menos 6 caracteres', 400);
            return;
        }
        $user = $this->findById($userId, 'user_id');
        if (!$user) {
            Response::error('Usuario no encontrado', 404);
            return;
        }

        $forcePasswordChange = isset($user->force_password_change) && (int)$user->force_password_change === 1;

        if (!$forcePasswordChange && $current === '') {
            Response::error('Se requiere contraseña actual', 400);
            return;
        }

        if ($current !== '') {
            $stored = (string) ($user->password_system ?? '');
            $isHashed = (strlen($stored) >= 60 && (strpos($stored, '$2y$') === 0 || strpos($stored, '$2a$') === 0)) || strpos($stored, '$argon2') === 0;
            $valid = $isHashed ? password_verify($current, $stored) : hash_equals($stored, $current);
            if (!$valid) {
                Response::error('Contraseña actual incorrecta', 400);
                return;
            }
        }
        $hash = password_hash($newPass, PASSWORD_DEFAULT);
        $stmt = $this->db->prepare("UPDATE users SET password_system = ?, force_password_change = 0 WHERE user_id = ?");
        $stmt->execute([$hash, $userId]);
        Response::success(null, 'Contraseña actualizada correctamente');
    }

    /**
     * POST /api/v1/users/me/photo
     * Subir foto de perfil del usuario autenticado. Body: multipart/form-data con campo "photo".
     * Actualiza persons.photo_url y devuelve el usuario con la nueva photo_url.
     */
    public function uploadProfilePhoto($params = []) {
        $payload = requireAuth();
        $userId = isset($payload['user_id']) ? (int) $payload['user_id'] : null;
        if (!$userId) {
            Response::error('Usuario no identificado', 401);
        }
        $user = $this->findById($userId, 'user_id');
        if (!$user || empty($user->person_id)) {
            Response::error('Usuario o persona no encontrada', 404);
        }
        require_once __DIR__ . '/../helpers/upload_storage.php';
        $result = storePublicPhoto($_FILES['photo'] ?? null, 'profiles');
        if (!$result['success']) {
            Response::error($result['error'] ?? 'Error al subir la imagen', 400);
        }
        $stmt = $this->db->prepare("UPDATE persons SET photo_url = ? WHERE id = ?");
        $stmt->execute([$result['photo_url'], $user->person_id]);
        $sql = "SELECT u.user_id, u.person_id, u.role_system, u.username_system, u.house_id, u.status_validated, u.status_reason, u.status_system, u.is_active,
                       p.type_doc, p.doc_number, p.first_name, p.paternal_surname, p.maternal_surname, p.gender, p.birth_date, p.cel_number, p.email, p.photo_url, p.civil_status, p.address, p.district, p.province, p.region
                FROM users u LEFT JOIN persons p ON u.person_id = p.id WHERE u.user_id = ? LIMIT 1";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$userId]);
        $updated = $stmt->fetch(\PDO::FETCH_OBJ);
        Response::success($updated, 'Foto de perfil actualizada');
    }
}

/**
 * Registrar rutas del controlador
 */
function registerUserRoutes(Router $router) {
    $router->prefix('/api/v1/users')->get('/by-birthday', 'UserController@byBirthday');
}
