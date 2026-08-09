<?php
/**
 * PublicRegistrationController - Registro público sin login
 *
 * POST /api/v1/public/register
 * Acepta el formulario completo: vivienda + propietario(s) + vehículos + mascotas.
 * No requiere autenticación.
 */

namespace Controllers;

require_once __DIR__ . '/../utils/Response.php';
require_once __DIR__ . '/../db_connection.php';
require_once __DIR__ . '/../helpers/license_plate.php';
require_once __DIR__ . '/../helpers/vehicle_type_rules.php';
require_once __DIR__ . '/../helpers/identity_document.php';

use Utils\Response;

class PublicRegistrationController
{
    private $pdo;

    public function __construct()
    {
        $this->pdo = getDbConnection();
    }

    private function getInput(): array
    {
        $input = file_get_contents('php://input');
        if ($input === false || $input === '') {
            return [];
        }
        $data = json_decode($input, true);
        return is_array($data) ? $data : [];
    }

    /**
     * GET /api/v1/public/houses
     * Lista solo casas aún sin propietario registrado (para registro público de propietarios).
     * A medida que se registran, esos domicilios dejan de aparecer.
     */
    public function listHouses(): void
    {
        $stmt = $this->pdo->query("
            SELECT h.house_id, h.house_type, h.block_house, h.lot, CAST(COALESCE(h.apartment, '') AS CHAR) AS apartment
            FROM houses h
            WHERE NOT EXISTS (
                SELECT 1 FROM persons p WHERE p.house_id = h.house_id AND p.person_type = 'PROPIETARIO'
            )
            ORDER BY h.block_house, h.lot, h.apartment
        ");
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);
        // Normalizar apartment: siempre string (101, 102...) o vacío para CASA/LC
        $houses = array_map(function ($row) {
            $row['apartment'] = ($row['apartment'] ?? '') !== '' ? (string) $row['apartment'] : null;
            return $row;
        }, $rows);
        Response::json(['success' => true, 'data' => $houses]);
    }

    /**
     * GET /api/v1/public/check-doc?doc_number=
     * Comprueba si un DNI/documento ya está registrado. Siempre 200; evita 404 en el formulario de registro.
     * Respuesta: { "success": true, "registered": true|false }
     */
    public function checkDoc(): void
    {
        $rawDoc = trim((string) ($_GET['doc_number'] ?? ''));
        if ($rawDoc === '') {
            Response::json(['success' => true, 'registered' => false]);
            return;
        }
        $doc = normalize_untyped_identity_document($rawDoc);
        if ($doc === '') {
            Response::json(['success' => false, 'error' => 'Documento inválido. Use DNI o CE.'], 422);
            return;
        }
        $stmt = $this->pdo->prepare("SELECT 1 FROM persons WHERE doc_number = ? LIMIT 1");
        $stmt->execute([$doc]);
        $registered = $stmt->fetch() !== false;
        Response::json(['success' => true, 'registered' => $registered]);
    }

    /**
     * POST /api/v1/public/register
     * Body: {
     *   house: { house_type, block_house, lot, apartment? },
     *   owners: [ { doc_number, first_name, paternal_surname, maternal_surname?, cel_number?, email?, type_doc?, gender?, birth_date?, address?, district?, province?, region?, civil_status? } ],
     *   vehicles?: [ { license_plate, type_vehicle?, brand?, color?, photo_url? } ],
     *   pets?: [ { species, name, breed?, color?, age_years?, photo_url? } ]
     * }
     * Nota producción: La consulta DNI (apidev) se usa solo para rellenar nombres en el formulario.
     * No se persisten gender, birth_date, address, district, province, region de esa API.
     */
    public function register(): void
    {
        $data = $this->getInput();

        $house = $data['house'] ?? null;
        $owners = $data['owners'] ?? [];
        $vehicles = $data['vehicles'] ?? [];
        $pets = $data['pets'] ?? [];

        if (!$house || !is_array($house)) {
            Response::json(['success' => false, 'error' => 'Falta objeto house (house_type, block_house, lot)'], 400);
            return;
        }
        if (empty($owners) || !is_array($owners)) {
            Response::json(['success' => false, 'error' => 'Debe enviar al menos un propietario en owners[]'], 400);
            return;
        }

        $houseType = $house['house_type'] ?? '';
        $blockHouse = $house['block_house'] ?? '';
        $lot = $house['lot'] ?? null;
        $apartment = $house['apartment'] ?? null;
        $allowedTypes = ['CASA', 'DEPARTAMENTO', 'LOCAL COMERCIAL', 'OTRO'];
        if (!in_array($houseType, $allowedTypes)) {
            Response::json(['success' => false, 'error' => 'house_type debe ser: CASA, DEPARTAMENTO, LOCAL COMERCIAL u OTRO'], 400);
            return;
        }
        if ($blockHouse === '' || $lot === null || $lot === '') {
            Response::json(['success' => false, 'error' => 'house debe incluir block_house y lot'], 400);
            return;
        }

        foreach ($owners as $i => &$o) {
            if (empty($o['doc_number']) || empty($o['first_name']) || empty($o['paternal_surname'])) {
                Response::json(['success' => false, 'error' => "Propietario " . ($i + 1) . ": se requieren doc_number, first_name y paternal_surname"], 400);
                return;
            }
            try {
                $identity = require_valid_identity_document($o['type_doc'] ?? '', $o['doc_number']);
                $o['type_doc'] = $identity['type'];
                $o['doc_number'] = $identity['value'];
            } catch (\InvalidArgumentException $e) {
                Response::json(['success' => false, 'error' => 'Propietario ' . ($i + 1) . ': ' . $e->getMessage()], 422);
                return;
            }
        }
        unset($o);

        // Propietarios duplicados en el mismo envío (mismo doc_number en más de un titular)
        $ownerDocs = array_map(function ($o) {
            return trim((string) ($o['doc_number'] ?? ''));
        }, $owners);
        $uniqueDocs = array_unique(array_filter($ownerDocs));
        if (count($uniqueDocs) < count($ownerDocs)) {
            Response::json(['success' => false, 'error' => 'Propietario duplicado: no puede registrar el mismo DNI en más de un titular.'], 400);
            return;
        }

        foreach ($vehicles as $i => $v) {
            $typeV = mb_strtoupper(trim((string) ($v['type_vehicle'] ?? '')), 'UTF-8');
            if (!vehicle_type_is_known($typeV)) {
                Response::json(['success' => false, 'error' => 'Vehículo ' . ($i + 1) . ': type_vehicle no válido'], 400);
                return;
            }
            if (vehicle_type_requires_license_plate($typeV)) {
                $np = normalize_license_plate((string) ($v['license_plate'] ?? ''));
                if (!validate_license_plate($np)) {
                    Response::json(['success' => false, 'error' => 'Vehículo ' . ($i + 1) . ': placa peruana inválida; use 6 letras o números'], 422);
                    return;
                }
            } elseif (trim((string) ($v['photo_url'] ?? '')) === '') {
                Response::json(['success' => false, 'error' => 'Vehículo ' . ($i + 1) . ': para bicicleta o moto eléctrica debe subir la foto del vehículo'], 400);
                return;
            }
        }

        // Vehículos duplicados en el mismo envío (misma placa más de una vez; solo tipos con placa)
        $plates = [];
        foreach ($vehicles as $v) {
            $typeV = mb_strtoupper(trim((string) ($v['type_vehicle'] ?? '')), 'UTF-8');
            if (!vehicle_type_requires_license_plate($typeV)) {
                continue;
            }
            $plates[] = normalize_license_plate((string) ($v['license_plate'] ?? ''));
        }
        if (count(array_unique($plates)) < count($plates)) {
            Response::json(['success' => false, 'error' => 'Vehículo duplicado: no puede registrar la misma placa más de una vez.'], 400);
            return;
        }

        // Mascotas duplicadas en el mismo envío (misma especie + nombre)
        $petKeys = array_map(function ($p) {
            return strtoupper(trim((string) ($p['species'] ?? ''))) . '|' . strtoupper(trim((string) ($p['name'] ?? '')));
        }, $pets);
        if (count(array_unique($petKeys)) < count($petKeys)) {
            Response::json(['success' => false, 'error' => 'Mascota duplicada: no puede registrar la misma mascota (especie y nombre) más de una vez.'], 400);
            return;
        }

        foreach ($pets as $i => $p) {
            if (empty($p['name']) || empty($p['species'])) {
                Response::json(['success' => false, 'error' => "Mascota " . ($i + 1) . ": se requieren name y species (PERRO, GATO, AVE, PEQUEÑO MAMÍFERO, ACUÁTICO, EXÓTICO, OTRO)"], 400);
                return;
            }
            $speciesAllowed = ['PERRO', 'GATO', 'AVE', 'PEQUEÑO MAMÍFERO', 'ACUÁTICO', 'EXÓTICO', 'OTRO'];
            if (!in_array($p['species'], $speciesAllowed)) {
                Response::json(['success' => false, 'error' => "Mascota " . ($i + 1) . ": species debe ser una de: PERRO, GATO, AVE, PEQUEÑO MAMÍFERO, ACUÁTICO, EXÓTICO, OTRO"], 400);
                return;
            }
        }

        try {
            $this->pdo->beginTransaction();

            $apartmentVal = ($apartment !== '' && $apartment !== null) ? $apartment : null;
            $lotInt = (int) $lot;

            $stmt = $this->pdo->prepare("SELECT house_id FROM houses WHERE block_house = ? AND lot = ? AND (apartment <=> ?) LIMIT 1");
            $stmt->execute([$blockHouse, $lotInt, $apartmentVal]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);

            if ($row) {
                $houseId = (int) $row['house_id'];
            } else {
                $stmt = $this->pdo->prepare("INSERT INTO houses (house_type, block_house, lot, apartment, status_system) VALUES (?, ?, ?, ?, 'ACTIVO')");
                $stmt->execute([$houseType, $blockHouse, $lotInt, $apartmentVal]);
                $houseId = (int) $this->pdo->lastInsertId();
            }

            // Invariante: cada propietario → exactamente 1 fila en persons → exactamente 1 fila en users (en ese orden).
            $personIds = [];
            foreach ($owners as $i => $o) {
                $doc = trim($o['doc_number']);
                $stmt = $this->pdo->prepare("SELECT id FROM persons WHERE doc_number = ? LIMIT 1");
                $stmt->execute([$doc]);
                if ($stmt->fetch()) {
                    $this->pdo->rollBack();
                    Response::json(['success' => false, 'error' => 'Ya existe una persona con documento ' . $doc], 409);
                    return;
                }
                $stmt = $this->pdo->prepare("
                    INSERT INTO persons (type_doc, doc_number, first_name, paternal_surname, maternal_surname, gender, birth_date, cel_number, email, address, district, province, region, civil_status, person_type, house_id, status_validated, status_system)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPIETARIO', ?, 'PERMITIDO', 'ACTIVO')
                ");
                // Guardar nombres y ubicación en MAYÚSCULAS para igualar con datos de apidev/Nuevo Residente
                $first = isset($o['first_name']) ? mb_strtoupper(trim($o['first_name']), 'UTF-8') : '';
                $paternal = isset($o['paternal_surname']) ? mb_strtoupper(trim($o['paternal_surname']), 'UTF-8') : '';
                $maternal = isset($o['maternal_surname']) && $o['maternal_surname'] !== '' ? mb_strtoupper(trim($o['maternal_surname']), 'UTF-8') : null;
                $typeDoc = isset($o['type_doc']) ? mb_strtoupper(trim($o['type_doc']), 'UTF-8') : 'DNI';
                $gender = isset($o['gender']) && $o['gender'] !== '' ? mb_strtoupper(trim($o['gender']), 'UTF-8') : null;
                $address = isset($o['address']) && $o['address'] !== '' ? mb_strtoupper(trim($o['address']), 'UTF-8') : null;
                $district = isset($o['district']) && $o['district'] !== '' ? mb_strtoupper(trim($o['district']), 'UTF-8') : null;
                $province = isset($o['province']) && $o['province'] !== '' ? mb_strtoupper(trim($o['province']), 'UTF-8') : null;
                $region = isset($o['region']) && $o['region'] !== '' ? mb_strtoupper(trim($o['region']), 'UTF-8') : null;
                $civilStatus = isset($o['civil_status']) && $o['civil_status'] !== '' ? mb_strtoupper(trim($o['civil_status']), 'UTF-8') : null;
                $stmt->execute([
                    $typeDoc,
                    $doc,
                    $first,
                    $paternal,
                    $maternal,
                    $gender,
                    isset($o['birth_date']) && $o['birth_date'] !== '' ? $o['birth_date'] : null,
                    isset($o['cel_number']) ? trim($o['cel_number']) : null,
                    isset($o['email']) ? trim($o['email']) : null,
                    $address,
                    $district,
                    $province,
                    $region,
                    $civilStatus,
                    $houseId
                ]);
                $newId = (int) $this->pdo->lastInsertId();
                if ($newId <= 0) {
                    $this->pdo->rollBack();
                    Response::json(['success' => false, 'error' => 'Error al crear persona (propietario ' . ($i + 1) . ')'], 500);
                    return;
                }
                $personIds[] = $newId;
            }

            if (count($personIds) !== count($owners)) {
                $this->pdo->rollBack();
                Response::json(['success' => false, 'error' => 'Inconsistencia: no se crearon todas las personas'], 500);
                return;
            }

            // house_members: cada propietario es miembro de la casa (fuente de verdad)
            foreach ($personIds as $idx => $pid) {
                $stmt = $this->pdo->prepare("
                    INSERT IGNORE INTO house_members (house_id, person_id, relation_type, is_active, is_primary)
                    VALUES (?, ?, 'PROPIETARIO', 1, ?)
                ");
                $stmt->execute([$houseId, $pid, $idx === 0 ? 1 : 0]);
            }

            // Usuarios: cada propietario recibe acceso (username = primera letra nombre + apellido; contraseña temporal = DNI).
            // Solo se crea user si la persona existe en persons y pertenece a esta casa.
            $createdUsers = [];
            foreach ($personIds as $idx => $pid) {
                $stmt = $this->pdo->prepare("SELECT id FROM persons WHERE id = ? AND house_id = ? LIMIT 1");
                $stmt->execute([$pid, $houseId]);
                if (!$stmt->fetch()) {
                    $this->pdo->rollBack();
                    Response::json(['success' => false, 'error' => 'Persona no encontrada o domicilio no coincide (propietario ' . ($idx + 1) . ')'], 500);
                    return;
                }
                $o = $owners[$idx];
                $first = trim($o['first_name'] ?? '');
                $paternal = trim($o['paternal_surname'] ?? '');
                $doc = trim($o['doc_number'] ?? '');
                $base = strtoupper(mb_substr($first, 0, 1) . preg_replace('/\s+/', '', $paternal));
                $username = $base;
                $suffix = 0;
                while (true) {
                    $stmt = $this->pdo->prepare("SELECT 1 FROM users WHERE username_system = ? LIMIT 1");
                    $stmt->execute([$username]);
                    if (!$stmt->fetch()) break;
                    $suffix++;
                    $username = $base . ($suffix > 1 ? (string) $suffix : '2');
                }
                $stmt = $this->pdo->prepare("
                    INSERT INTO users (person_id, username_system, password_system, role_system, house_id, status_validated, status_system, is_active, force_password_change)
                    VALUES (?, ?, ?, 'USUARIO', ?, 'PERMITIDO', 'ACTIVO', 1, 1)
                ");
                $stmt->execute([
                    $pid,
                    $username,
                    password_hash($doc, PASSWORD_DEFAULT),
                    $houseId
                ]);
                $createdUsers[] = ['person_id' => $pid, 'username_system' => $username, 'temporary_password' => $doc];
            }

            $firstOwnerId = $personIds[0] ?? null;
            $vehicleIds = [];
            foreach ($vehicles as $v) {
                $typeV = mb_strtoupper(trim((string) ($v['type_vehicle'] ?? '')), 'UTF-8');
                $plate = null;
                if (vehicle_type_requires_license_plate($typeV)) {
                    $plate = normalize_license_plate((string) ($v['license_plate'] ?? ''));
                    $stmt = $this->pdo->prepare('SELECT vehicle_id FROM vehicles WHERE license_plate = ? LIMIT 1');
                    $stmt->execute([$plate]);
                    if ($stmt->fetch()) {
                        $this->pdo->rollBack();
                        Response::json(['success' => false, 'error' => 'Ya existe un vehículo con la placa ' . $plate], 409);
                        return;
                    }
                }
                $stmt = $this->pdo->prepare("
                    INSERT INTO vehicles (license_plate, type_vehicle, house_id, owner_id, brand, model, color, photo_url, status_validated, status_system)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PERMITIDO', 'ACTIVO')
                ");
                $stmt->execute([
                    $plate,
                    $typeV,
                    $houseId,
                    $firstOwnerId,
                    $v['brand'] ?? null,
                    $v['model'] ?? null,
                    $v['color'] ?? null,
                    $v['photo_url'] ?? null
                ]);
                $vehicleIds[] = (int) $this->pdo->lastInsertId();
            }

            $petIds = [];
            foreach ($pets as $p) {
                $stmt = $this->pdo->prepare("
                    INSERT INTO pets (name, species, breed, color, age_years, house_id, owner_id, photo_url, status_validated, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PERMITIDO', NOW(), NOW())
                ");
                $stmt->execute([
                    trim($p['name']),
                    $p['species'],
                    $p['breed'] ?? '',
                    $p['color'] ?? '',
                    isset($p['age_years']) ? (int) $p['age_years'] : null,
                    $houseId,
                    $firstOwnerId,
                    $p['photo_url'] ?? null
                ]);
                $petIds[] = (int) $this->pdo->lastInsertId();
            }

            $this->pdo->commit();

            Response::json([
                'success' => true,
                'data' => [
                    'house_id' => $houseId,
                    'person_ids' => $personIds,
                    'vehicle_ids' => $vehicleIds,
                    'pet_ids' => $petIds,
                    'created_users' => $createdUsers
                ],
                'message' => 'Registro completado. Use su usuario y contraseña temporal (DNI) para ingresar; deberá cambiar la contraseña en el primer acceso.'
            ], 201);
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::json(['success' => false, 'error' => $e->getMessage()], 500);
        }
    }

    /**
     * POST /api/v1/public/upload/vehicle-photo
     * Sube una foto de vehículo (registro público, sin auth). Multipart: campo "photo".
     * Devuelve { "success": true, "photo_url": "/uploads/public/vehicles/xxx.jpg" }.
     */
    public function uploadVehiclePhoto(): void
    {
        require_once __DIR__ . '/../helpers/upload_storage.php';
        $result = storePublicPhoto($_FILES['photo'] ?? null, 'vehicles');
        if (!$result['success']) {
            Response::json(['success' => false, 'error' => $result['error']], 400);
            return;
        }
        Response::json(['success' => true, 'photo_url' => $result['photo_url']]);
    }

    /**
     * POST /api/v1/public/upload/pet-photo
     * Sube una foto de mascota (registro público, sin auth). Multipart: campo "photo".
     * Devuelve { "success": true, "photo_url": "/uploads/public/pets/xxx.jpg" }.
     */
    public function uploadPetPhoto(): void
    {
        require_once __DIR__ . '/../helpers/upload_storage.php';
        $result = storePublicPhoto($_FILES['photo'] ?? null, 'pets');
        if (!$result['success']) {
            Response::json(['success' => false, 'error' => $result['error']], 400);
            return;
        }
        Response::json(['success' => true, 'photo_url' => $result['photo_url']]);
    }
}
