<?php
/**
 * Manejador Centralizado de Errores para VC-INGRESO
 * 
 * Este archivo proporciona funciones para manejar errores de manera consistente
 * en toda la aplicación, evitando exponer información sensible en producción.
 */

// Determinar si estamos en producción
$GLOBALS['isProduction'] = getenv('APP_ENV') === 'production' || getenv('APP_DEBUG') !== 'true';

// Configurar el manejador de errores de PHP
set_error_handler('customErrorHandler');
set_exception_handler('customExceptionHandler');

/**
 * Manejador de errores de PHP
 */
function customErrorHandler($errno, $errstr, $errfile, $errline) {
    $isProduction = $GLOBALS['isProduction'];
    
    // No procesar si el error está suprimido con @
    if (!(error_reporting() & $errno)) {
        return false;
    }
    
    $errorTypes = [
        E_ERROR => 'ERROR',
        E_WARNING => 'WARNING',
        E_PARSE => 'PARSE',
        E_NOTICE => 'NOTICE',
        E_CORE_ERROR => 'CORE_ERROR',
        E_CORE_WARNING => 'CORE_WARNING',
        E_COMPILE_ERROR => 'COMPILE_ERROR',
        E_COMPILE_WARNING => 'COMPILE_WARNING',
        E_USER_ERROR => 'USER_ERROR',
        E_USER_WARNING => 'USER_WARNING',
        E_USER_NOTICE => 'USER_NOTICE',
        E_STRICT => 'STRICT',
        E_RECOVERABLE_ERROR => 'RECOVERABLE_ERROR',
        E_DEPRECATED => 'DEPRECATED',
        E_USER_DEPRECATED => 'USER_DEPRECATED',
    ];
    
    $type = $errorTypes[$errno] ?? 'UNKNOWN';
    $timestamp = date('Y-m-d H:i:s');
    
    // Log del error
    error_log("[$timestamp] PHP $type: $errstr in $errfile:$errline");
    
    // En producción, solo enviar mensaje genérico
    if ($isProduction) {
        // No exponer detalles del error en producción
        return true;
    }
    
    // En desarrollo, enviar detalles (para debug)
    return false; // Dejar que PHP maneje el error normalmente en desarrollo
}

/**
 * Manejador de excepciones no capturadas
 */
function customExceptionHandler($exception) {
    $isProduction = $GLOBALS['isProduction'];
    
    $timestamp = date('Y-m-d H:i:s');
    $message = $exception->getMessage();
    $file = $exception->getFile();
    $line = $exception->getLine();
    $trace = $exception->getTraceAsString();
    
    // Log del error
    error_log("[$timestamp] EXCEPTION: $message in $file:$line");
    error_log("[$timestamp] TRACE: $trace");
    
    // Preparar respuesta
    if ($isProduction) {
        $response = [
            'success' => false,
            'error' => 'Error interno del servidor',
            'code' => 500
        ];
        http_response_code(500);
    } else {
        $response = [
            'success' => false,
            'error' => $message,
            'file' => $file,
            'line' => $line,
            'trace' => $trace,
            'code' => 500
        ];
        http_response_code(500);
    }
    
    // Evitar exponer errores PHP en la respuesta
    ini_set('display_errors', 0);
    
    header('Content-Type: application/json');
    echo json_encode($response);
    
    // Terminar ejecución
    exit(1);
}

/**
 * Función helper para enviar respuestas de error consistentes
 */
function sendErrorResponse($message, $statusCode = 400, $details = null) {
    $isProduction = $GLOBALS['isProduction'];
    
    $response = [
        'success' => false,
        'error' => $message
    ];
    
    if (!$isProduction && $details !== null) {
        $response['details'] = $details;
    }
    
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($response);
    exit;
}

/**
 * Función helper para enviar respuestas de éxito consistentes
 */
function sendSuccessResponse($data = null, $message = 'Operación exitosa') {
    $response = [
        'success' => true,
        'message' => $message
    ];
    
    if ($data !== null) {
        $response['data'] = $data;
    }
    
    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode($response);
}

/**
 * Validar que el request sea JSON
 */
function requireJsonInput() {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    
    if (!str_contains($contentType, 'application/json')) {
        sendErrorResponse('Content-Type debe ser application/json', 415);
    }
}

/**
 * Obtener y decodificar JSON de entrada
 */
function getJsonInput() {
    requireJsonInput();
    
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        sendErrorResponse('JSON inválido: ' . json_last_error_msg(), 400);
    }
    
    if (!is_array($data)) {
        sendErrorResponse('El JSON debe ser un objeto o array', 400);
    }
    
    return $data;
}

/**
 * Validar campos requeridos en un array
 */
function validateRequired($data, $requiredFields) {
    $missing = [];
    
    foreach ($requiredFields as $field) {
        if (!isset($data[$field]) || (empty($data[$field]) && $data[$field] !== 0 && $data[$field] !== false)) {
            $missing[] = $field;
        }
    }
    
    if (!empty($missing)) {
        sendErrorResponse('Campos requeridos faltantes: ' . implode(', ', $missing), 400);
    }
    
    return true;
}

/**
 * Validar formato de fecha
 */
function validateDate($date, $format = 'Y-m-d') {
    $d = DateTime::createFromFormat($format, $date);
    return $d && $d->format($format) === $date;
}

/**
 * Sanitizar entrada para prevenir XSS
 */
function sanitizeOutput($data) {
    if (is_array($data)) {
        return array_map('sanitizeOutput', $data);
    }
    
    return htmlspecialchars($data ?? '', ENT_QUOTES, 'UTF-8');
}

/**
 * Registrar acción en log de auditoría (persiste en event_logs si hay BD).
 */
function auditLog($action, $userId = null, $details = null) {
    try {
        require_once __DIR__ . '/db_connection.php';
        require_once __DIR__ . '/helpers/event_log.php';
        $db = getDbConnection();
        $auth = $userId !== null ? ['user_id' => (int) $userId] : null;
        recordEventLog($db, $auth, (string) $action, [
            'summary' => (string) $action,
            'details' => $details,
        ]);
    } catch (\Throwable $e) {
        $timestamp = date('Y-m-d H:i:s');
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        $logEntry = [
            'timestamp' => $timestamp,
            'action' => $action,
            'user_id' => $userId,
            'ip' => $ip,
            'details' => $details,
        ];
        error_log('[AUDIT] ' . json_encode($logEntry));
    }
}
