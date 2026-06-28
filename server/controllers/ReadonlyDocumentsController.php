<?php

namespace Controllers;

require_once __DIR__ . '/../utils/Response.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../db_connection.php';
require_once __DIR__ . '/../helpers/event_log.php';

use Utils\Response;

class ReadonlyDocumentsController
{
    private static function storagePath(): string
    {
        return __DIR__ . '/../storage/readonly_data.json';
    }

    /**
     * Compatibilidad con implementación anterior (solo documentos).
     * Si existe y el nuevo JSON no tiene documentos (o está vacío), se migra una vez.
     */
    private static function legacyStoragePath(): string
    {
        return __DIR__ . '/../storage/readonly_documents.json';
    }

    private static function ensureStorageDir(): void
    {
        $dir = dirname(self::storagePath());
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
    }

    private static function defaultData(): array
    {
        return [
            'tutorial_topics' => [],
            'documents' => [],
            'authorization_url' => '',
            'emergency_contacts' => [],
            'announcements' => [],
        ];
    }

    private static function normalizeAnnouncements($items): array
    {
        if (!is_array($items)) {
            return [];
        }
        $out = [];
        foreach ($items as $item) {
            if (!is_array($item)) continue;
            $id = trim((string) ($item['id'] ?? ''));
            $title = trim((string) ($item['title'] ?? ''));
            $message = trim((string) ($item['message'] ?? ''));
            if ($title === '' || $message === '') continue;
            $out[] = [
                'id' => ($id !== '' ? $id : null),
                'title' => $title,
                'message' => $message,
                'start_at' => trim((string) ($item['start_at'] ?? '')),
                'end_at' => trim((string) ($item['end_at'] ?? '')),
                'cta_label' => trim((string) ($item['cta_label'] ?? '')),
                'cta_url' => trim((string) ($item['cta_url'] ?? '')),
                'updated_at' => trim((string) ($item['updated_at'] ?? '')),
            ];
        }
        return $out;
    }

    private static function loadOrInitData(): array
    {
        self::ensureStorageDir();

        $path = self::storagePath();
        if (!is_file($path) || !is_readable($path)) {
            $data = self::defaultData();
            $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            file_put_contents($path, $payload, LOCK_EX);
            return $data;
        }

        $raw = file_get_contents($path);
        $data = json_decode($raw ?: '{}', true);
        if (!is_array($data)) {
            $data = self::defaultData();
        }

        // Migración simple desde `readonly_documents.json` (si existe).
        $legacyPath = self::legacyStoragePath();
        if (is_file($legacyPath) && is_readable($legacyPath)) {
            $legacyRaw = file_get_contents($legacyPath);
            $legacy = json_decode($legacyRaw ?: '{}', true);
            if (is_array($legacy)) {
                $legacyDocs = $legacy['documents'] ?? null;
                $legacyAuthUrl = $legacy['authorization_url'] ?? '';
                $docsEmpty = empty($data['documents']) || !is_array($data['documents']);
                if ($docsEmpty && is_array($legacyDocs)) {
                    $data['documents'] = self::normalizeDocs($legacyDocs);
                    $data['authorization_url'] = trim((string) $legacyAuthUrl);
                }
            }
        }

        // Normalización mínima para evitar tipos incorrectos.
        if (!isset($data['tutorial_topics']) || !is_array($data['tutorial_topics'])) $data['tutorial_topics'] = [];
        if (!isset($data['documents']) || !is_array($data['documents'])) $data['documents'] = [];
        if (!isset($data['authorization_url']) || !is_string($data['authorization_url'])) $data['authorization_url'] = '';
        if (!isset($data['emergency_contacts']) || !is_array($data['emergency_contacts'])) $data['emergency_contacts'] = [];
        if (!isset($data['announcements']) || !is_array($data['announcements'])) $data['announcements'] = [];

        return $data;
    }

    private static function normalizeDocs($docs): array
    {
        if (!is_array($docs)) {
            return [];
        }
        $out = [];
        foreach ($docs as $d) {
            if (!is_array($d)) continue;
            $title = trim((string) ($d['title'] ?? ''));
            $url = trim((string) ($d['url'] ?? ''));
            $description = trim((string) ($d['description'] ?? ''));
            if ($title === '' || $url === '') continue;
            $out[] = [
                'title' => $title,
                'url' => $url,
                'description' => ($description === '' ? null : $description),
            ];
        }
        return $out;
    }

    public static function index(): void
    {
        requireAuth();
        $data = self::loadOrInitData();
        $docs = self::normalizeDocs($data['documents'] ?? []);
        $data['documents'] = $docs;
        $data['authorization_url'] = trim((string) ($data['authorization_url'] ?? ''));
        $data['announcements'] = self::normalizeAnnouncements($data['announcements'] ?? []);

        Response::json(['success' => true, 'data' => $data]);
    }

    public static function update(): void
    {
        $auth = requireAuth();
        if (!isAdminRole($auth)) {
            Response::error('Solo administradores pueden editar documentos.', 403);
            return;
        }

        $raw = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);
        if (!is_array($body)) {
            Response::error('JSON inválido', 400);
            return;
        }

        $data = self::loadOrInitData();

        $data['documents'] = self::normalizeDocs($body['documents'] ?? []);
        $data['authorization_url'] = trim((string) ($body['authorization_url'] ?? ''));

        $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if ($payload === false) {
            Response::error('No se pudo serializar el contenido.', 500);
            return;
        }

        $path = self::storagePath();
        $ok = file_put_contents($path, $payload, LOCK_EX);
        if ($ok === false) {
            Response::error('No se pudo guardar el archivo de readonly data.', 500);
            return;
        }

        recordEventLog(getDbConnection(), $auth, 'readonly_documents.update', [
            'summary' => 'Documentos de solo lectura actualizados',
            'entity_type' => 'readonly_documents',
            'details' => ['documents_count' => count($data['documents'] ?? [])],
        ]);

        Response::json(['success' => true, 'data' => $data]);
    }

    /**
     * Upload de documento para listado por URL.
     * Importante: NO existe endpoint de borrado: al “quitar” la URL del listado solo
     * se elimina la referencia en JSON; el archivo subido permanece en el servidor.
     */
    public static function upload(): void
    {
        $auth = requireAuth();
        if (!isAdminRole($auth)) {
            Response::error('Solo administradores pueden subir documentos.', 403);
            return;
        }

        $file = $_FILES['file'] ?? null;
        if (!$file || !isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            Response::error('No se ha subido ningún archivo.', 400);
            return;
        }

        $allowedExts = [
            'pdf',
            'doc', 'docx', 'odt', 'rtf',
            'xls', 'xlsx', 'ods', 'csv',
            'txt', 'md', 'log',
            'ppt', 'pptx', 'odp',
            'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'
        ];
        $maxSizeBytes = 20 * 1024 * 1024; // 20 MB

        $ext = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
        if ($ext === '' || !in_array($ext, $allowedExts, true)) {
            Response::error('Formato no permitido. Extensión no aceptada.', 400);
            return;
        }
        if (($file['size'] ?? 0) > $maxSizeBytes) {
            Response::error('El archivo no debe superar 20 MB.', 400);
            return;
        }

        $baseDir = __DIR__ . '/../uploads/public/readonly-docs/';
        if (!is_dir($baseDir)) {
            if (!@mkdir($baseDir, 0755, true)) {
                Response::error('Error al crear directorio de almacenamiento.', 500);
                return;
            }
        }

        $safeName = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', (string) ($file['name'] ?? 'document'));
        $title = pathinfo($safeName, PATHINFO_FILENAME);
        $filename = date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
        $filepath = $baseDir . $filename;

        if (!move_uploaded_file($file['tmp_name'], $filepath)) {
            Response::error('Error al guardar el archivo.', 500);
            return;
        }

        $url = '/uploads/public/readonly-docs/' . $filename;
        recordEventLog(getDbConnection(), $auth, 'readonly_documents.upload', [
            'summary' => 'Documento subido: ' . ($title !== '' ? $title : $filename),
            'entity_type' => 'readonly_documents',
            'details' => ['url' => $url, 'ext' => $ext],
        ]);
        Response::json([
            'success' => true,
            'data' => [
                'url' => $url,
                'title' => ($title !== '' ? $title : $filename),
                'ext' => $ext
            ]
        ]);
    }
}

