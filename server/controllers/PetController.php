<?php
/**
 * PetController - Gestión de Mascotas
 * 
 * Endpoints para CRUD de mascotas
 */

namespace Controllers;

require_once __DIR__ . '/../utils/Response.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../db_connection.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';

use Utils\Response;

class PetController {
    private $pdo;
    
    public function __construct() {
        try {
            $this->pdo = getDbConnection();
        } catch (\Throwable $e) {
            Response::json([
                'success' => false,
                'error' => 'Error de conexión a la base de datos: ' . $e->getMessage()
            ], 500);
            exit;
        }
    }

    /**
     * Lee el body JSON de la petición (POST/PUT)
     */
    private function getInput(): array {
        $input = file_get_contents('php://input');
        if ($input === false || $input === '') {
            return [];
        }
        $data = json_decode($input, true);
        return is_array($data) ? $data : [];
    }

    /**
     * GET /api/v1/pets
     * Lista todas las mascotas con filtros opcionales
     */
    public function index($params = []) {
        try {
            $auth = requireAuth();
            if (!isStaffRole($auth) && !isTenantUser($this->pdo, $auth)) {
                if (empty($params['house_id']) || $params['house_id'] === '') {
                    Response::json(['success' => false, 'error' => 'Indique house_id para listar mascotas'], 403);
                    return;
                }
            }
            if (isStaffRole($auth) && empty($params['house_id']) && !canViewModule($this->pdo, $auth, 'pets')) {
                Response::json(['success' => false, 'error' => 'Sin permiso'], 403);
                return;
            }
            // Si filtra por casa, debe tener acceso a esa casa
            if (isset($params['house_id']) && $params['house_id'] !== '' && $params['house_id'] !== null) {
                if (!canAccessHouse($this->pdo, $auth, (int) $params['house_id'])) {
                    Response::json(['success' => false, 'error' => 'Sin permiso para ver mascotas de esta casa'], 403);
                    return;
                }
            }

            $sql = "SELECT p.*,
                           h.block_house, h.lot, h.apartment,
                           o.doc_number as owner_doc,
                           o.first_name as owner_first_name,
                           o.paternal_surname as owner_paternal_surname
                    FROM pets p
                    INNER JOIN houses h ON p.house_id = h.house_id
                    LEFT JOIN persons o ON p.owner_id = o.id
                    WHERE 1=1";
            
            $types = [];
            $values = [];
            
            // Filtro por house_id (principal: mascotas de una casa)
            if (isset($params['house_id']) && $params['house_id'] !== '' && $params['house_id'] !== null) {
                $sql .= " AND p.house_id = ?";
                $values[] = $params['house_id'];
            }

            // Inquilino (USUARIO + person_type INQUILINO): solo sus mascotas
            if (isTenantUser($this->pdo, $auth)) {
                $tid = (int) ($auth['person_id'] ?? 0);
                if ($tid > 0) {
                    $sql .= " AND p.owner_id = ?";
                    $values[] = $tid;
                }
            } elseif (isset($params['owner_id']) && !empty($params['owner_id'])) {
                // Filtro por owner_id (opcional, no inquilino)
                $sql .= " AND p.owner_id = ?";
                $values[] = $params['owner_id'];
            }
            
            // Filtro por status_validated
            if (isset($params['status']) && !empty($params['status'])) {
                $sql .= " AND p.status_validated = ?";
                $types[] = 's';
                $values[] = $params['status'];
            }
            
            // Filtro por species
            if (isset($params['species']) && !empty($params['species'])) {
                $sql .= " AND p.species = ?";
                $types[] = 's';
                $values[] = $params['species'];
            }
            
            $sql .= " ORDER BY p.created_at DESC";
            
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($values);
            $pets = $stmt->fetchAll(\PDO::FETCH_ASSOC);
            
            Response::json([
                'success' => true,
                'data' => $pets,
                'count' => count($pets)
            ]);
        } catch (\Exception $e) {
            Response::json([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    /**
     * GET /api/v1/pets/:id
     * Obtiene una mascota por ID
     */
    public function show($id) {
        try {
            $auth = requireAuth();
            $stmt = $this->pdo->prepare("SELECT p.*,
                                                h.block_house, h.lot, h.apartment,
                                                o.doc_number as owner_doc,
                                                o.first_name as owner_first_name,
                                                o.paternal_surname as owner_paternal_surname
                                         FROM pets p
                                         INNER JOIN houses h ON p.house_id = h.house_id
                                         LEFT JOIN persons o ON p.owner_id = o.id
                                         WHERE p.id = ?");
            $stmt->execute([$id]);
            $pet = $stmt->fetch(\PDO::FETCH_ASSOC);
            
            if (!$pet) {
                Response::json([
                    'success' => false,
                    'error' => 'Mascota no encontrada'
                ], 404);
                return;
            }
            if (!canAccessHouse($this->pdo, $auth, (int) $pet['house_id'])) {
                Response::json(['success' => false, 'error' => 'Sin permiso para ver esta mascota'], 403);
                return;
            }
            if (isTenantUser($this->pdo, $auth)) {
                $tid = (int) ($auth['person_id'] ?? 0);
                if ($tid <= 0 || (int) ($pet['owner_id'] ?? 0) !== $tid) {
                    Response::json(['success' => false, 'error' => 'Sin permiso para ver esta mascota'], 403);
                    return;
                }
            }
            Response::json([
                'success' => true,
                'data' => $pet
            ]);
        } catch (\Exception $e) {
            Response::json([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    /**
     * GET /api/v1/pets/person/:person_id
     * Obtiene las mascotas de un propietario
     */
    public function byOwner($person_id) {
        try {
            $auth = requireAuth();
            if (isTenantUser($this->pdo, $auth)) {
                $tid = (int) ($auth['person_id'] ?? 0);
                if ($tid !== (int) $person_id) {
                    Response::json(['success' => false, 'error' => 'Sin permiso'], 403);
                    return;
                }
            }

            $stmt = $this->pdo->prepare("SELECT * FROM pets WHERE owner_id = ? ORDER BY created_at DESC");
            $stmt->execute([$person_id]);
            $pets = $stmt->fetchAll(\PDO::FETCH_ASSOC);
            
            Response::json([
                'success' => true,
                'data' => $pets,
                'count' => count($pets)
            ]);
        } catch (\Exception $e) {
            Response::json([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    /**
     * POST /api/v1/pets
     * Crea una nueva mascota
     */
    public function store($data = []) {
        try {
            $auth = requireAuth();
            if (isStaffRole($auth) && !canManageModule($this->pdo, $auth, 'pets')) {
                Response::json(['success' => false, 'error' => 'Sin permiso para registrar mascotas (solo lectura)'], 403);
                return;
            }
            $data = $data ?: $this->getInput();

            // Validar datos requeridos (gestión por casa)
            if (empty($data['name']) || empty($data['species']) || empty($data['house_id'])) {
                Response::json([
                    'success' => false,
                    'error' => 'Faltan datos requeridos: name, species, house_id'
                ], 400);
                return;
            }
            $houseId = (int) $data['house_id'];
            if (!canAccessHouse($this->pdo, $auth, $houseId)) {
                Response::json(['success' => false, 'error' => 'Sin permiso para crear mascotas en esta casa'], 403);
                return;
            }
            if (isTenantUser($this->pdo, $auth)) {
                $tid = (int) ($auth['person_id'] ?? 0);
                if ($tid <= 0) {
                    Response::json(['success' => false, 'error' => 'Sesión sin persona asociada'], 403);
                    return;
                }
                $data['owner_id'] = $tid;
            }
            $ownerId = isset($data['owner_id']) ? (int) $data['owner_id'] : null;
            if ($ownerId !== null && !validateOwnerInHouse($this->pdo, $houseId, $ownerId)) {
                Response::json(['success' => false, 'error' => 'El responsable (owner_id) debe ser miembro activo de la misma casa'], 400);
                return;
            }
            $createdBy = isset($auth['user_id']) ? (int) $auth['user_id'] : null;

            $sql = "INSERT INTO pets (name, species, breed, color, age_years, house_id, owner_id, photo_url, status_validated, microchip_id, created_by_user_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())";

            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                $data['name'],
                $data['species'],
                $data['breed'] ?? '',
                $data['color'] ?? '',
                isset($data['age_years']) ? (int) $data['age_years'] : null,
                $data['house_id'],
                $data['owner_id'] ?? null,
                $data['photo_url'] ?? null,
                $data['status_validated'] ?? 'PERMITIDO',
                $data['microchip_id'] ?? null,
                $createdBy
            ]);
            
            $id = $this->pdo->lastInsertId();
            
            Response::json([
                'success' => true,
                'data' => ['id' => $id, ...$data],
                'message' => 'Mascota creada exitosamente'
            ], 201);
        } catch (\Exception $e) {
            Response::json([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    /**
     * PUT /api/v1/pets/:id
     * Actualiza una mascota
     */
    public function update($id, $data = []) {
        try {
            $auth = requireAuth();
            if (isStaffRole($auth) && !canManageModule($this->pdo, $auth, 'pets')) {
                Response::json(['success' => false, 'error' => 'Sin permiso para editar mascotas (solo lectura)'], 403);
                return;
            }
            $data = $data ?: $this->getInput();

            $stmt = $this->pdo->prepare("SELECT id, house_id, owner_id FROM pets WHERE id = ?");
            $stmt->execute([$id]);
            $pet = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$pet) {
                Response::json([
                    'success' => false,
                    'error' => 'Mascota no encontrada'
                ], 404);
                return;
            }
            if (!canAccessHouse($this->pdo, $auth, (int) $pet['house_id'])) {
                Response::json(['success' => false, 'error' => 'Sin permiso para editar esta mascota'], 403);
                return;
            }
            if (isTenantUser($this->pdo, $auth)) {
                $tid = (int) ($auth['person_id'] ?? 0);
                if ($tid <= 0 || (int) ($pet['owner_id'] ?? 0) !== $tid) {
                    Response::json(['success' => false, 'error' => 'Sin permiso para editar esta mascota'], 403);
                    return;
                }
                $data['owner_id'] = $tid;
            }
            $houseId = isset($data['house_id']) ? (int) $data['house_id'] : (int) $pet['house_id'];
            if (isset($data['house_id']) && (int) $data['house_id'] !== (int) $pet['house_id']) {
                if (!canAccessHouse($this->pdo, $auth, (int) $data['house_id'])) {
                    Response::json(['success' => false, 'error' => 'Sin permiso para asignar esta casa a la mascota'], 403);
                    return;
                }
            }
            if (isset($data['owner_id'])) {
                $ownerId = $data['owner_id'] === null || $data['owner_id'] === '' ? null : (int) $data['owner_id'];
                if ($ownerId !== null && !validateOwnerInHouse($this->pdo, $houseId, $ownerId)) {
                    Response::json(['success' => false, 'error' => 'El responsable (owner_id) debe ser miembro activo de la misma casa'], 400);
                    return;
                }
            }
            $updatedBy = isset($auth['user_id']) ? (int) $auth['user_id'] : null;

            $allowedFields = ['name', 'species', 'breed', 'color', 'age_years', 'house_id', 'owner_id', 'photo_url', 'status_validated', 'status_reason', 'microchip_id'];
            $updates = [];
            $values = [];
            foreach ($data as $key => $value) {
                if (in_array($key, $allowedFields)) {
                    $updates[] = "$key = ?";
                    $values[] = $value;
                }
            }
            $updates[] = 'updated_by_user_id = ?';
            $values[] = $updatedBy;
            if (empty($updates)) {
                Response::json([
                    'success' => false,
                    'error' => 'No hay campos válidos para actualizar'
                ], 400);
                return;
            }
            $values[] = $id;
            $sql = "UPDATE pets SET " . implode(', ', $updates) . ", updated_at = NOW() WHERE id = ?";
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($values);
            
            Response::json([
                'success' => true,
                'message' => 'Mascota actualizada exitosamente'
            ]);
        } catch (\Exception $e) {
            Response::json([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    /**
     * PUT /api/v1/pets/:id/validate
     * Cambia el estado de validación de una mascota
     */
    public function validate($id, $data = []) {
        try {
            $auth = requireAuth();
            $stmt = $this->pdo->prepare("SELECT id, house_id, owner_id FROM pets WHERE id = ?");
            $stmt->execute([$id]);
            $pet = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$pet) {
                Response::json(['success' => false, 'error' => 'Mascota no encontrada'], 404);
                return;
            }
            if (!canAccessHouse($this->pdo, $auth, (int) $pet['house_id'])) {
                Response::json(['success' => false, 'error' => 'Sin permiso para validar esta mascota'], 403);
                return;
            }
            if (isTenantUser($this->pdo, $auth)) {
                $tid = (int) ($auth['person_id'] ?? 0);
                if ($tid <= 0 || (int) ($pet['owner_id'] ?? 0) !== $tid) {
                    Response::json(['success' => false, 'error' => 'Sin permiso para validar esta mascota'], 403);
                    return;
                }
            }
            $data = $data ?: $this->getInput();

            $allowedStatuses = ['PERMITIDO', 'OBSERVADO', 'DENEGADO'];

            if (empty($data['status_validated']) || !in_array($data['status_validated'], $allowedStatuses)) {
                Response::json([
                    'success' => false,
                    'error' => 'Estado inválido. Estados permitidos: PERMITIDO, OBSERVADO, DENEGADO'
                ], 400);
                return;
            }
            
            $stmt = $this->pdo->prepare("UPDATE pets SET status_validated = ?, status_reason = ?, updated_at = NOW() WHERE id = ?");
            $stmt->execute([
                $data['status_validated'],
                $data['status_reason'] ?? null,
                $id
            ]);
            
            Response::json([
                'success' => true,
                'message' => 'Estado de validación actualizado'
            ]);
        } catch (\Exception $e) {
            Response::json([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    /**
     * DELETE /api/v1/pets/:id
     * Elimina una mascota
     */
    public function destroy($id) {
        try {
            $auth = requireAuth();
            if (isStaffRole($auth) && !canManageModule($this->pdo, $auth, 'pets')) {
                Response::json(['success' => false, 'error' => 'Sin permiso para eliminar mascotas (solo lectura)'], 403);
                return;
            }
            $stmt = $this->pdo->prepare("SELECT id, house_id, owner_id FROM pets WHERE id = ?");
            $stmt->execute([$id]);
            $pet = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$pet) {
                Response::json([
                    'success' => false,
                    'error' => 'Mascota no encontrada'
                ], 404);
                return;
            }
            if (!canAccessHouse($this->pdo, $auth, (int) $pet['house_id'])) {
                Response::json(['success' => false, 'error' => 'Sin permiso para eliminar esta mascota'], 403);
                return;
            }
            if (isTenantUser($this->pdo, $auth)) {
                $tid = (int) ($auth['person_id'] ?? 0);
                if ($tid <= 0 || (int) ($pet['owner_id'] ?? 0) !== $tid) {
                    Response::json(['success' => false, 'error' => 'Sin permiso para eliminar esta mascota'], 403);
                    return;
                }
            }
            $stmt = $this->pdo->prepare("DELETE FROM pets WHERE id = ?");
            $stmt->execute([$id]);
            
            Response::json([
                'success' => true,
                'message' => 'Mascota eliminada exitosamente'
            ]);
        } catch (\Exception $e) {
            Response::json([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    /**
     * POST /api/v1/pets/:id/photo
     * Sube una foto de la mascota
     */
    public function uploadPhoto($id) {
        try {
            $auth = requireAuth();
            $stmt = $this->pdo->prepare("SELECT id, house_id, owner_id FROM pets WHERE id = ?");
            $stmt->execute([$id]);
            $pet = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$pet) {
                Response::json(['success' => false, 'error' => 'Mascota no encontrada'], 404);
                return;
            }
            if (!canAccessHouse($this->pdo, $auth, (int) $pet['house_id'])) {
                Response::json(['success' => false, 'error' => 'Sin permiso para subir foto a esta mascota'], 403);
                return;
            }
            if (isTenantUser($this->pdo, $auth)) {
                $tid = (int) ($auth['person_id'] ?? 0);
                if ($tid <= 0 || (int) ($pet['owner_id'] ?? 0) !== $tid) {
                    Response::json(['success' => false, 'error' => 'Sin permiso para subir foto a esta mascota'], 403);
                    return;
                }
            }
            if (!isset($_FILES['photo'])) {
                Response::json([
                    'success' => false,
                    'error' => 'No se ha subido ninguna imagen'
                ], 400);
                return;
            }
            
            $uploadDir = __DIR__ . '/../../uploads/pets/';
            if (!is_dir($uploadDir)) {
                mkdir($uploadDir, 0755, true);
            }
            
            $file = $_FILES['photo'];
            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            $allowedExts = ['jpg', 'jpeg', 'png', 'gif'];
            
            if (!in_array($ext, $allowedExts)) {
                Response::json([
                    'success' => false,
                    'error' => 'Formato de imagen no permitido'
                ], 400);
                return;
            }
            
            $filename = "pet_{$id}_{$file['name']}";
            $filepath = $uploadDir . $filename;
            
            if (move_uploaded_file($file['tmp_name'], $filepath)) {
                $photoUrl = "/uploads/pets/{$filename}";
                
                $stmt = $this->pdo->prepare("UPDATE pets SET photo_url = ?, updated_at = NOW() WHERE id = ?");
                $stmt->execute([$photoUrl, $id]);
                
                Response::json([
                    'success' => true,
                    'photo_url' => $photoUrl,
                    'message' => 'Foto subida exitosamente'
                ]);
            } else {
                Response::json([
                    'success' => false,
                    'error' => 'Error al subir la imagen'
                ], 500);
            }
        } catch (\Exception $e) {
            Response::json([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
