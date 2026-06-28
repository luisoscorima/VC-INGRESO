<?php
/**
 * VC-INGRESO API - Entry Point (MVC)
 * 
 * Punto de entrada unico para todas las peticiones API.
 * Sistema de control de acceso para condominio.
 */

// Cargar variables de entorno desde .env (proyecto raíz o server/)
$envFile = file_exists(__DIR__ . '/../.env') ? __DIR__ . '/../.env' : __DIR__ . '/.env';
if ($envFile && is_readable($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0) continue;
        if (strpos($line, '=') !== false) {
            list($name, $value) = explode('=', $line, 2);
            $name = trim($name);
            $value = trim($value, " \t\n\r\0\x0B\"'");
            if ($name !== '' && getenv($name) === false) {
                putenv("$name=$value");
                $_ENV[$name] = $value;
            }
        }
    }
}

date_default_timezone_set(getenv('APP_TIMEZONE') ?: 'America/Lima');

// CORS: enviar siempre desde PHP (funciona con servidor integrado PHP o Apache)
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Accept');
header('Access-Control-Max-Age: 86400');
header('Content-Type: application/json');

// Preflight OPTIONS: responder 204 con las cabeceras anteriores
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Autoload simple para las nuevas clases
spl_autoload_register(function ($class) {
    $prefix = 'Utils\\';
    $baseDir = __DIR__ . '/utils/';
    
    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        $prefix2 = 'Controllers\\';
        $baseDir2 = __DIR__ . '/controllers/';
        $len2 = strlen($prefix2);
        if (strncmp($prefix2, $class, $len2) === 0) {
            $className = substr($class, $len2);
            $file = $baseDir2 . $className . '.php';
            if (file_exists($file)) {
                require_once $file;
            }
        }
        return;
    }
    
    $className = substr($class, $len);
    $file = $baseDir . $className . '.php';
    
    if (file_exists($file)) {
        require_once $file;
    }
});

// Incluir archivos necesarios
require_once __DIR__ . '/error-handler.php';
require_once __DIR__ . '/auth_middleware.php';
require_once __DIR__ . '/sanitize.php';

// Obtener ruta
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Servir archivos subidos (fotos) en GET /uploads/... (desde server/uploads/)
if ($method === 'GET' && str_starts_with($uri, '/uploads/')) {
    $filePath = __DIR__ . $uri;
    if (is_file($filePath) && is_readable($filePath)) {
        $mime = mime_content_type($filePath);
        $ext = strtolower(pathinfo($uri, PATHINFO_EXTENSION));
        $allowedExts = [
            // Images (existing)
            'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
            // Documents
            'pdf',
            'doc', 'docx', 'odt', 'rtf',
            'xls', 'xlsx', 'ods', 'csv',
            'txt', 'md', 'log',
            'ppt', 'pptx', 'odp',
            // Archives (optional)
            'zip', 'rar', '7z', 'tar', 'gz'
        ];

        // Servir imágenes y documentos permitidos.
        $ok = is_string($mime) && str_starts_with($mime, 'image/');
        if (!$ok && in_array($ext, $allowedExts, true)) {
            $ok = true;
        }

        if ($ok) {
            header('Content-Type: ' . ($mime ?: 'application/octet-stream'));
            header('Cache-Control: public, max-age=86400');
            readfile($filePath);
            exit;
        }
    }
}

// API v1 Routes
if (str_starts_with($uri, '/api/v1/')) {
    $path = substr($uri, strlen('/api/v1/'));

    // ==================== AUTH (login sin token) ====================
    if (str_starts_with($path, 'auth/')) {
        if ($path === 'auth/login' && $method === 'POST') {
            require_once __DIR__ . '/controllers/AuthController.php';
            \Controllers\AuthController::login();
            exit;
        }
    }

    // ==================== CATALOG (access_points, resumen dashboard) ====================
    if (str_starts_with($path, 'catalog/')) {
        require_once __DIR__ . '/controllers/CatalogController.php';
        if ($path === 'catalog/dashboard-summary' && $method === 'GET') { \Controllers\CatalogController::dashboardSummary(); exit; }
        if ($path === 'catalog/access-points' && $method === 'POST') { \Controllers\CatalogController::accessPointsStore(); exit; }
        if (preg_match('#^catalog/access-points/(\d+)$#', $path, $m) && $method === 'PUT') { \Controllers\CatalogController::accessPointsUpdate($m[1]); exit; }
        if ($path === 'catalog/areas' && $method === 'GET') { \Controllers\CatalogController::areas(); exit; }
    }

    // ==================== REGISTRO PÚBLICO (sin login) ====================
    if (str_starts_with($path, 'public/')) {
        require_once __DIR__ . '/controllers/PublicRegistrationController.php';
        $controller = new \Controllers\PublicRegistrationController();
        if ($path === 'public/register' && $method === 'POST') {
            $controller->register();
            exit;
        }
        if ($path === 'public/houses' && $method === 'GET') {
            $controller->listHouses();
            exit;
        }
        if ($path === 'public/check-doc' && $method === 'GET') {
            $controller->checkDoc();
            exit;
        }
        if ($path === 'public/upload/vehicle-photo' && $method === 'POST') {
            $controller->uploadVehiclePhoto();
            exit;
        }
        if ($path === 'public/upload/pet-photo' && $method === 'POST') {
            $controller->uploadPetPhoto();
            exit;
        }
    }

    // ==================== NAV PERMISSIONS ====================
    if ($path === 'config/nav-permissions' && $method === 'GET') {
        require_once __DIR__ . '/controllers/NavPermissionsController.php';
        (new \Controllers\NavPermissionsController())->resolveForSession();
        exit;
    }
    if ($path === 'admin/nav-permissions' && $method === 'GET') {
        require_once __DIR__ . '/controllers/NavPermissionsController.php';
        (new \Controllers\NavPermissionsController())->adminMatrix();
        exit;
    }
    if ($path === 'admin/nav-permissions' && $method === 'PUT') {
        require_once __DIR__ . '/controllers/NavPermissionsController.php';
        (new \Controllers\NavPermissionsController())->adminUpdate();
        exit;
    }
    if ($path === 'admin/event-logs/actions' && $method === 'GET') {
        require_once __DIR__ . '/controllers/EventLogController.php';
        (new \Controllers\EventLogController())->actionsCatalog();
        exit;
    }
    if ($path === 'admin/event-logs' && $method === 'GET') {
        require_once __DIR__ . '/controllers/EventLogController.php';
        (new \Controllers\EventLogController())->index();
        exit;
    }

    // ==================== USERS ====================
    if (str_starts_with($path, 'users')) {
        require_once __DIR__ . '/controllers/UserController.php';
        $controller = new \Controllers\UserController();
        
        if ($path === 'users/me/photo' && $method === 'POST') {
            $controller->uploadProfilePhoto();
            exit;
        }
        if ($path === 'users/me/person' && $method === 'PUT') {
            $controller->updateMyPerson();
            exit;
        }
        if ($path === 'users/me/password' && $method === 'PUT') {
            $controller->changeMyPassword();
            exit;
        }

        if ($path === 'users/check-username' && $method === 'GET') {
            $controller->checkUsernameAvailability([]);
            exit;
        }
        
        if (str_contains($path, 'from-person') && $method === 'POST') {
            $controller->createFromPerson();
            exit;
        }
        
        if (str_contains($path, 'by-doc-number') && $method === 'GET') {
            $controller->byDocNumber([]);
            exit;
        }
        
        if (str_contains($path, 'by-birthday') && $method === 'GET') {
            $controller->byBirthday([]);
            exit;
        }
        
        if (preg_match('#^users(?:/(\d+))?#', $path, $matches)) {
            $id = $matches[1] ?? null;
            
            switch ($method) {
                case 'GET':
                    if ($id) {
                        $controller->show(['id' => $id]);
                    } else {
                        $controller->index();
                    }
                    break;
                case 'POST':
                    $controller->store();
                    break;
                case 'PUT':
                    if ($id) {
                        $controller->updateUser(['id' => $id]);
                    }
                    break;
                case 'DELETE':
                    if ($id) {
                        require_once __DIR__ . '/utils/Response.php';
                        \Utils\Response::error('No se permite eliminar usuarios; los registros se conservan por trazabilidad.', 403);
                        exit;
                    }
                    break;
            }
            exit;
        }
    }

    // ==================== READONLY CONTENT (Documentos solo lectura) ====================
    if ($path === 'readonly/content') {
        require_once __DIR__ . '/controllers/ReadonlyDocumentsController.php';
        if ($method === 'GET') {
            \Controllers\ReadonlyDocumentsController::index();
            exit;
        }
    }

    if ($path === 'readonly/content/documents') {
        require_once __DIR__ . '/controllers/ReadonlyDocumentsController.php';
        if ($method === 'PUT') {
            \Controllers\ReadonlyDocumentsController::update();
            exit;
        }
    }

    // Compatibilidad: /readonly/documents (antiguo)
    if ($path === 'readonly/documents') {
        require_once __DIR__ . '/controllers/ReadonlyDocumentsController.php';
        if ($method === 'GET') {
            \Controllers\ReadonlyDocumentsController::index();
            exit;
        }
        if ($method === 'PUT') {
            \Controllers\ReadonlyDocumentsController::update();
            exit;
        }
    }

    if ($path === 'readonly/documents/upload') {
        require_once __DIR__ . '/controllers/ReadonlyDocumentsController.php';
        if ($method === 'POST') {
            \Controllers\ReadonlyDocumentsController::upload();
            exit;
        }
    }

    // ==================== ANNOUNCEMENTS (Comunicados) ====================
    if ($path === 'announcements/active' && $method === 'GET') {
        require_once __DIR__ . '/controllers/AnnouncementController.php';
        \Controllers\AnnouncementController::active();
        exit;
    }

    if ($path === 'announcements' && $method === 'GET') {
        require_once __DIR__ . '/controllers/AnnouncementController.php';
        \Controllers\AnnouncementController::index();
        exit;
    }

    if ($path === 'announcements' && $method === 'POST') {
        require_once __DIR__ . '/controllers/AnnouncementController.php';
        \Controllers\AnnouncementController::store();
        exit;
    }

    if ($path === 'announcements/upload-image' && $method === 'POST') {
        require_once __DIR__ . '/controllers/AnnouncementController.php';
        \Controllers\AnnouncementController::uploadImage();
        exit;
    }

    if (preg_match('#^announcements/(\d+)$#', $path, $m)) {
        require_once __DIR__ . '/controllers/AnnouncementController.php';
        if ($method === 'PUT') {
            \Controllers\AnnouncementController::update((int) $m[1]);
            exit;
        }
        if ($method === 'DELETE') {
            \Controllers\AnnouncementController::destroy((int) $m[1]);
            exit;
        }
    }

    // ==================== SURVEYS (Encuestas) ====================
    if ($path === 'surveys' && $method === 'GET') {
        require_once __DIR__ . '/controllers/SurveyController.php';
        \Controllers\SurveyController::index();
        exit;
    }
    if ($path === 'surveys/active' && $method === 'GET') {
        require_once __DIR__ . '/controllers/SurveyController.php';
        \Controllers\SurveyController::active();
        exit;
    }
    if ($path === 'surveys' && $method === 'POST') {
        require_once __DIR__ . '/controllers/SurveyController.php';
        \Controllers\SurveyController::store();
        exit;
    }
    if (preg_match('#^surveys/(\d+)/respond$#', $path, $m) && $method === 'POST') {
        require_once __DIR__ . '/controllers/SurveyController.php';
        \Controllers\SurveyController::respond((int) $m[1]);
        exit;
    }
    if (preg_match('#^surveys/(\d+)/results$#', $path, $m) && $method === 'GET') {
        require_once __DIR__ . '/controllers/SurveyController.php';
        \Controllers\SurveyController::results((int) $m[1]);
        exit;
    }
    if (preg_match('#^surveys/(\d+)$#', $path, $m)) {
        require_once __DIR__ . '/controllers/SurveyController.php';
        if ($method === 'PUT') {
            \Controllers\SurveyController::update((int) $m[1]);
            exit;
        }
        if ($method === 'DELETE') {
            \Controllers\SurveyController::destroy((int) $m[1]);
            exit;
        }
    }
    
    // ==================== HOUSES ====================
    if (str_starts_with($path, 'houses')) {
        require_once __DIR__ . '/controllers/HouseController.php';
        $controller = new \Controllers\HouseController();
        
        if (preg_match('#^houses/(\d+)/members$#', $path, $m)) {
            if ($method === 'GET') {
                $controller->members(['id' => $m[1]]);
            }
            exit;
        }
        
        if (preg_match('#^houses(?:/(\d+))?#', $path, $matches)) {
            $id = $matches[1] ?? null;
            
            switch ($method) {
                case 'GET':
                    if ($id) {
                        $controller->show(['id' => $id]);
                    } else {
                        $controller->index();
                    }
                    break;
                case 'POST':
                    $controller->store();
                    break;
                case 'PUT':
                    if ($id) {
                        $controller->updateHouse(['id' => $id]);
                    }
                    break;
                case 'DELETE':
                    if ($id) {
                        $controller->destroy(['id' => $id]);
                    }
                    break;
            }
            exit;
        }
    }
    
    // ==================== VEHICLES ====================
    if (str_starts_with($path, 'vehicles')) {
        require_once __DIR__ . '/controllers/VehicleController.php';
        $controller = new \Controllers\VehicleController();
        
        if (str_contains($path, 'by-house') && $method === 'GET') {
            $houseId = $_GET['house_id'] ?? null;
            $controller->byHouse(['house_id' => $houseId]);
            exit;
        }
        
        if (preg_match('#^vehicles(?:/(\d+))?#', $path, $matches)) {
            $id = $matches[1] ?? null;
            
            switch ($method) {
                case 'GET':
                    if ($id) {
                        $controller->show(['id' => $id]);
                    } else {
                        $controller->index();
                    }
                    break;
                case 'POST':
                    $controller->store();
                    break;
                case 'PUT':
                    if ($id) {
                        $controller->updateVehicle(['id' => $id]);
                    }
                    break;
                case 'DELETE':
                    if ($id) {
                        $controller->destroy(['id' => $id]);
                    }
                    break;
            }
            exit;
        }
    }
    
    // ==================== PERSONS ====================
    if (str_starts_with($path, 'persons')) {
        require_once __DIR__ . '/controllers/PersonController.php';
        $controller = new \Controllers\PersonController();
        
        if (preg_match('#^persons(?:/(\d+))?#', $path, $matches)) {
            $id = $matches[1] ?? null;
            
            switch ($method) {
                case 'GET':
                    if ($id) {
                        $controller->show(['id' => $id]);
                    } else {
                        $controller->index($_GET);
                    }
                    break;
                case 'POST':
                    $controller->store();
                    break;
                case 'PUT':
                    if ($id) {
                        $controller->updatePerson(['id' => $id]);
                    }
                    break;
                case 'DELETE':
                    if ($id) {
                        $controller->destroy(['id' => $id]);
                    }
                    break;
            }
            exit;
        }
        
        // by-doc-number
        if (str_contains($path, 'by-doc-number')) {
            if ($method === 'GET') {
                $docNumber = $_GET['doc_number'] ?? null;
                $controller->byDocNumber(['doc_number' => $docNumber]);
            }
            exit;
        }
        
        // persons/destacados
        if (str_contains($path, 'destacados')) {
            if ($method === 'GET') {
                $controller->destacados([]);
            }
            exit;
        }
        
        // persons list by birthday (fecha_cumple)
        if (str_contains($path, 'list-by-birthday') || (preg_match('#^persons$#', $path) && $method === 'GET' && isset($_GET['fecha_cumple']))) {
            if ($method === 'GET') {
                $controller->listByBirthday([]);
            }
            exit;
        }
        
        // observed (estado OBSERVADO)
        if (str_contains($path, 'observed')) {
            if ($method === 'GET') {
                $controller->observed([]);
            }
            exit;
        }
        
        // restricted (estado DENEGADO)
        if (str_contains($path, 'restricted')) {
            if ($method === 'GET') {
                $controller->restricted([]);
            }
            exit;
        }
        
        // validate (cambiar estado de validacion)
        if (str_contains($path, 'validate')) {
            if ($method === 'PUT' && preg_match('#^persons/(\d+)/validate#', $path, $m)) {
                $controller->validate(['id' => $m[1]]);
            }
            exit;
        }
    }
    
    // ==================== EXTERNAL VISITS (temporary_visits) ====================
    if (str_starts_with($path, 'external-visits')) {
        require_once __DIR__ . '/controllers/ExternalVehicleController.php';
        $controller = new \Controllers\ExternalVehicleController();

        if ($path === 'external-visits/lookup' && $method === 'GET') {
            $controller->lookup();
            exit;
        }
        
        if (preg_match('#^external-visits(?:/(\d+))?#', $path, $matches)) {
            $id = $matches[1] ?? null;
            
            switch ($method) {
                case 'GET':
                    if ($id) {
                        $controller->show(['id' => $id]);
                    } else {
                        $controller->index();
                    }
                    break;
                case 'POST':
                    $controller->store();
                    break;
                case 'PUT':
                    if ($id) {
                        $controller->updateExternalVehicle(['id' => $id]);
                    }
                    break;
                case 'DELETE':
                    if ($id) {
                        $controller->destroy(['id' => $id]);
                    }
                    break;
            }
            exit;
        }
    }
    
    // ==================== PETS ====================
    if (str_starts_with($path, 'pets')) {
        require_once __DIR__ . '/controllers/PetController.php';
        $controller = new \Controllers\PetController();
        
        // pets/:id/photo - subir foto
        if (str_contains($path, 'photo') && preg_match('#^pets/(\d+)/photo#', $path, $m)) {
            if ($method === 'POST') {
                $controller->uploadPhoto($m[1]);
            }
            exit;
        }
        
        // pets/:id/validate - cambiar estado
        if (str_contains($path, 'validate') && preg_match('#^pets/(\d+)/validate#', $path, $m)) {
            if ($method === 'PUT') {
                $controller->validate($m[1], []);
            }
            exit;
        }
        
        // pets/person/:person_id - mascotas de un propietario
        if (str_contains($path, 'person/') && preg_match('#^pets/person/(\d+)#', $path, $m)) {
            if ($method === 'GET') {
                $controller->byOwner($m[1]);
            }
            exit;
        }
        
        // pets/:id
        if (preg_match('#^pets(?:/(\d+))?#', $path, $matches)) {
            $id = $matches[1] ?? null;
            
            switch ($method) {
                case 'GET':
                    if ($id) {
                        $controller->show($id);
                    } else {
                        $controller->index($_GET);
                    }
                    break;
                case 'POST':
                    $controller->store([]);
                    break;
                case 'PUT':
                    if ($id) {
                        $controller->update($id, []);
                    }
                    break;
                case 'DELETE':
                    if ($id) {
                        $controller->destroy($id);
                    }
                    break;
            }
            exit;
        }
    }
    
    // ==================== ACCESS INCIDENTS ====================
    if (str_starts_with($path, 'access-incidents')) {
        require_once __DIR__ . '/db_connection.php';
        require_once __DIR__ . '/controllers/AccessIncidentController.php';
        $pdo = getDbConnection();
        $incController = new \Controllers\AccessIncidentController($pdo);

        if (preg_match('#^access-incidents/by-log/(-?\d+)$#', $path, $m) && $method === 'GET') {
            $incController->byLog($m[1]);
            exit;
        }

        if (preg_match('#^access-incidents/(\d+)$#', $path, $m)) {
            if ($method === 'GET') {
                $incController->show($m[1]);
            }
            exit;
        }

        if ($path === 'access-incidents') {
            if ($method === 'GET') {
                $incController->index();
            } elseif ($method === 'POST') {
                $incController->store();
            }
            exit;
        }
    }

    // ==================== ACCESS LOGS ====================
    if (str_starts_with($path, 'access-logs')) {
        require_once __DIR__ . '/db_connection.php';
        require_once __DIR__ . '/controllers/AccessLogController.php';
        $pdo = getDbConnection();
        $controller = new \Controllers\AccessLogController($pdo);
        
        // access-logs/access-points
        if (str_contains($path, 'access-points')) {
            if ($method === 'GET') {
                $controller->accessPoints();
            }
            exit;
        }
        
        if ($method === 'GET') {
            if (str_contains($path, 'history-by-date')) { $controller->historyByDate(); exit; }
            if (str_contains($path, 'history-by-range')) { $controller->historyByRange(); exit; }
            if (str_contains($path, 'history-by-client')) { $controller->historyByClient(); exit; }
        }
        
        // Registro ingreso visita externa (temporary_access_logs)
        if ($path === 'access-logs/temporary/exit' && $method === 'POST') {
            $controller->exitTemporary();
            exit;
        }

        // Registro ingreso visita externa (temporary_access_logs)
        if ($path === 'access-logs/temporary' && $method === 'POST') {
            $controller->storeTemporary();
            exit;
        }

        // access-logs/:id
        if (preg_match('#^access-logs(?:/(\d+))?#', $path, $matches)) {
            $id = $matches[1] ?? null;
            
            switch ($method) {
                case 'GET':
                    if ($id) {
                        $controller->show($id);
                    } else {
                        $controller->index();
                    }
                    break;
                case 'POST':
                    $controller->store();
                    break;
            }
            exit;
        }
    }

    // ==================== ACCESS QR (vecinos generan, staff escanea) ====================
    if (str_starts_with($path, 'access-qr')) {
        require_once __DIR__ . '/db_connection.php';
        require_once __DIR__ . '/controllers/AccessQrController.php';
        $pdo = getDbConnection();
        $qrController = new \Controllers\AccessQrController($pdo);
        if ($path === 'access-qr/generate' && $method === 'POST') {
            $qrController->generate();
            exit;
        }
        if ($path === 'access-qr/validate' && $method === 'POST') {
            $qrController->validate();
            exit;
        }
        if ($path === 'access-qr/scan' && $method === 'POST') {
            $qrController->scan();
            exit;
        }
        if ($path === 'access-qr/scan-confirm' && $method === 'POST') {
            $qrController->scanConfirm();
            exit;
        }
    }
    
    // ==================== RESERVATIONS ====================
    if (str_starts_with($path, 'reservations')) {
        require_once __DIR__ . '/db_connection.php';
        require_once __DIR__ . '/controllers/ReservationController.php';
        $pdo = getDbConnection();
        $controller = new \Controllers\ReservationController($pdo);
        
        // reservations/areas
        if (str_contains($path, 'areas')) {
            if ($method === 'GET') {
                $controller->areas();
            }
            exit;
        }
        
        // reservations/availability
        if (str_contains($path, 'availability')) {
            if ($method === 'GET') {
                $controller->availability();
            }
            exit;
        }

        // reservations/holidays (festivos Perú, ICS Google; informativo)
        if (str_contains($path, 'holidays')) {
            if ($method === 'GET') {
                $controller->holidays();
            }
            exit;
        }

        // reservations/calendar (vista comunitaria; payload mínimo para casas ajenas)
        if (str_contains($path, 'calendar')) {
            if ($method === 'GET') {
                $controller->calendar();
            }
            exit;
        }
        
        // reservations/:id/status
        if (str_contains($path, 'status') && preg_match('#^reservations/(\d+)/status#', $path, $m)) {
            if ($method === 'PUT') {
                $controller->updateStatus($m[1]);
            }
            exit;
        }
        
        // reservations/:id
        if (preg_match('#^reservations(?:/(\d+))?#', $path, $matches)) {
            $id = $matches[1] ?? null;
            
            switch ($method) {
                case 'GET':
                    if ($id) {
                        $controller->show($id);
                    } else {
                        $controller->index();
                    }
                    break;
                case 'POST':
                    $controller->store();
                    break;
                case 'PUT':
                    if ($id) {
                        $controller->update($id);
                    }
                    break;
                case 'DELETE':
                    if ($id) {
                        $controller->destroy($id);
                    }
                    break;
            }
            exit;
        }
    }
}

// Ruta no encontrada (ya no se cargan archivos .php legacy)
http_response_code(404);
echo json_encode([
    'success' => false,
    'error' => 'Ruta no encontrada',
    'documentation' => 'Todas las rutas están bajo /api/v1/. Ver server/API.md',
    'available_routes' => [
            // Registro público (sin auth)
            'POST /api/v1/public/register' => 'Registro público: vivienda + propietarios + vehículos + mascotas',
            'GET /api/v1/public/houses' => 'Listar casas sin propietario (desplegables)',
            'POST /api/v1/public/upload/vehicle-photo' => 'Subir foto de vehículo (multipart)',
            'POST /api/v1/public/upload/pet-photo' => 'Subir foto de mascota (multipart)',
            // Users
            'GET /api/v1/users' => 'Listar todos los usuarios',
            'GET /api/v1/users/:id' => 'Obtener usuario por ID',
            'POST /api/v1/users' => 'Crear usuario',
            'PUT /api/v1/users/:id' => 'Actualizar usuario',
            'DELETE /api/v1/users/:id' => 'No permitido (conservación de registros)',
            'POST /api/v1/users/me/photo' => 'Subir foto de perfil (auth, multipart)',
            'GET /api/v1/users/by-birthday?fecha_cumple=MM-DD' => 'Usuarios por cumpleaños',
            
            // Houses
            'GET /api/v1/houses' => 'Listar casas',
            'GET /api/v1/houses/:id' => 'Obtener casa',
            'POST /api/v1/houses' => 'Crear casa',
            'PUT /api/v1/houses/:id' => 'Actualizar casa',
            'DELETE /api/v1/houses/:id' => 'Eliminar casa',
            
            // Vehicles
            'GET /api/v1/vehicles' => 'Listar vehículos',
            'GET /api/v1/vehicles/:id' => 'Obtener vehículo',
            'POST /api/v1/vehicles' => 'Crear vehículo',
            'PUT /api/v1/vehicles/:id' => 'Actualizar vehículo',
            'DELETE /api/v1/vehicles/:id' => 'Eliminar vehículo',
            'GET /api/v1/vehicles/by-house?house_id=:id' => 'Vehículos por casa',
            
            // Persons (unificado -取代 clients)
            'GET /api/v1/persons' => 'Listar personas',
            'GET /api/v1/persons/:id' => 'Obtener persona',
            'POST /api/v1/persons' => 'Crear persona',
            'PUT /api/v1/persons/:id' => 'Actualizar persona',
            'DELETE /api/v1/persons/:id' => 'Eliminar persona',
            'GET /api/v1/persons/by-doc-number?doc_number=:doc' => 'Por documento',
            'GET /api/v1/persons/observed' => 'Personas observadas',
            'GET /api/v1/persons/restricted' => 'Personas restringidas',
            'PUT /api/v1/persons/:id/validate' => 'Cambiar estado validación',
            
            // External Vehicles
            'GET /api/v1/external-visits' => 'Listar visitas externas (global staff | activas por casa)',
            'GET /api/v1/external-visits/lookup' => 'Buscar perfil global por placa/doc',
            'GET /api/v1/external-visits/:id' => 'Obtener visita externa',
            'POST /api/v1/external-visits' => 'Registrar visita externa + asignación',
            'PUT /api/v1/external-visits/:id' => 'Actualizar visita externa',
            'DELETE /api/v1/external-visits/:id' => 'Eliminar perfil o cancelar asignación',
            'POST /api/v1/access-qr/scan-confirm' => 'Confirmar casa en escaneo multi-casa',
            'POST /api/v1/access-logs/temporary' => 'Registrar ingreso visita externa',
            'POST /api/v1/access-logs/temporary/exit' => 'Registrar salida visita externa',
            
            // Pets (Mascotas)
            'GET /api/v1/pets' => 'Listar todas las mascotas',
            'GET /api/v1/pets/:id' => 'Obtener mascota por ID',
            'GET /api/v1/pets/person/:person_id' => 'Mascotas de un propietario',
            'POST /api/v1/pets' => 'Crear mascota',
            'PUT /api/v1/pets/:id' => 'Actualizar mascota',
            'PUT /api/v1/pets/:id/validate' => 'Cambiar estado de validación',
            'POST /api/v1/pets/:id/photo' => 'Subir foto de mascota',
            'DELETE /api/v1/pets/:id' => 'Eliminar mascota',
            
            // Access Logs (Logs de Acceso)
            'GET /api/v1/access-logs' => 'Listar logs de acceso',
            'GET /api/v1/access-logs/:id' => 'Obtener log por ID',
            'POST /api/v1/access-logs' => 'Crear registro de acceso',
            'GET /api/v1/access-logs/access-points' => 'Listar puntos de acceso',

            // Access QR (JWT ingreso; vecinos generan, staff valida/escanea)
            'POST /api/v1/access-qr/generate' => 'Generar token QR (person|vehicle)',
            'POST /api/v1/access-qr/validate' => 'Validar token QR (staff)',
            'POST /api/v1/access-qr/scan' => 'Escanear: JWT o DNI/placa manual (staff)',
            
            // Reservations (Reservaciones Casa Club)
            'GET /api/v1/reservations' => 'Listar reservaciones',
            'GET /api/v1/reservations/:id' => 'Obtener reservación',
            'POST /api/v1/reservations' => 'Crear reservación',
            'PUT /api/v1/reservations/:id' => 'Actualizar reservación',
            'PUT /api/v1/reservations/:id/status' => 'Cambiar estado',
            'DELETE /api/v1/reservations/:id' => 'Eliminar reservación',
            'GET /api/v1/reservations/areas' => 'Listar áreas disponibles',
            'GET /api/v1/reservations/availability' => 'Día lógico 8–8 libre u ocupado',
            'GET /api/v1/reservations/calendar' => 'Calendario comunitario (payload mínimo en ajenas)',
            'GET /api/v1/reservations/holidays' => 'Festivos Perú (ICS Google; informativo)'
        ]
]);
