<?php

namespace Controllers;

require_once __DIR__ . '/../db_connection.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';
require_once __DIR__ . '/../helpers/event_log.php';
require_once __DIR__ . '/../utils/Response.php';

use Utils\Response;

class AnnouncementController
{
    private static function ensureColumn(\PDO $pdo, string $column, string $sqlDefinition): void
    {
        // En algunos entornos MySQL/PDO, SHOW COLUMNS ... LIKE ? falla con syntax error.
        // Se usa quote() para construir SQL seguro sin placeholders en esta sentencia.
        $quoted = $pdo->quote($column);
        $stmt = $pdo->query("SHOW COLUMNS FROM announcements LIKE {$quoted}");
        $exists = $stmt ? $stmt->fetch(\PDO::FETCH_ASSOC) : false;
        if (!$exists) {
            $pdo->exec('ALTER TABLE announcements ADD COLUMN ' . $sqlDefinition);
        }
    }

    private static function ensureTable(\PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS announcements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(180) NOT NULL,
                message TEXT NOT NULL,
                start_at DATETIME NULL,
                end_at DATETIME NULL,
                cta_label VARCHAR(80) NULL,
                cta_url VARCHAR(500) NULL,
                image_url VARCHAR(600) NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        self::ensureColumn($pdo, 'image_url', 'image_url VARCHAR(600) NULL');
    }

    private static function normalizeRow(array $row): array
    {
        return [
            'id' => (int) ($row['id'] ?? 0),
            'title' => (string) ($row['title'] ?? ''),
            'message' => (string) ($row['message'] ?? ''),
            'start_at' => $row['start_at'] ?? null,
            'end_at' => $row['end_at'] ?? null,
            'cta_label' => $row['cta_label'] ?? null,
            'cta_url' => $row['cta_url'] ?? null,
            'image_url' => $row['image_url'] ?? null,
            'is_active' => ((int) ($row['is_active'] ?? 0)) === 1,
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }

    private static function readBody(): array
    {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);
        return is_array($body) ? $body : [];
    }

    private static function parseNullableDateTime($value): ?string
    {
        $v = trim((string) ($value ?? ''));
        if ($v === '') {
            return null;
        }
        $ts = strtotime($v);
        if ($ts === false) {
            return null;
        }
        return date('Y-m-d H:i:s', $ts);
    }

    public static function index(): void
    {
        $auth = requireAuth();
        $pdo = getDbConnection();
        if (!canViewModule($pdo, $auth, 'announcements')) {
            Response::error('Sin permiso para gestionar comunicados.', 403);
            return;
        }

        self::ensureTable($pdo);

        $stmt = $pdo->query('SELECT * FROM announcements ORDER BY COALESCE(start_at, created_at) DESC, id DESC');
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        $out = array_map([self::class, 'normalizeRow'], $rows);
        Response::success($out);
    }

    public static function active(): void
    {
        requireAuth();
        $pdo = getDbConnection();
        self::ensureTable($pdo);

        $sql = 'SELECT * FROM announcements
                WHERE is_active = 1
                  AND (start_at IS NULL OR start_at <= NOW())
                  AND (end_at IS NULL OR end_at >= NOW())
                ORDER BY COALESCE(start_at, created_at) DESC, id DESC';
        $stmt = $pdo->query($sql);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        $out = array_map([self::class, 'normalizeRow'], $rows);
        Response::success($out);
    }

    public static function store(): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'announcements')) {
            Response::error('Sin permiso para crear comunicados.', 403);
            return;
        }
        $body = self::readBody();
        $title = trim((string) ($body['title'] ?? ''));
        $message = trim((string) ($body['message'] ?? ''));
        if ($title === '' || $message === '') {
            Response::error('Título y mensaje son obligatorios.', 400);
            return;
        }

        $pdo = getDbConnection();
        self::ensureTable($pdo);
        $stmt = $pdo->prepare(
            'INSERT INTO announcements (title, message, start_at, end_at, cta_label, cta_url, image_url, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $title,
            $message,
            self::parseNullableDateTime($body['start_at'] ?? null),
            self::parseNullableDateTime($body['end_at'] ?? null),
            (($x = trim((string) ($body['cta_label'] ?? ''))) === '' ? null : $x),
            (($x = trim((string) ($body['cta_url'] ?? ''))) === '' ? null : $x),
            (($x = trim((string) ($body['image_url'] ?? ''))) === '' ? null : $x),
            !empty($body['is_active']) ? 1 : 0,
        ]);

        $id = (int) $pdo->lastInsertId();
        $q = $pdo->prepare('SELECT * FROM announcements WHERE id = ? LIMIT 1');
        $q->execute([$id]);
        $row = $q->fetch(\PDO::FETCH_ASSOC);
        recordEventLog($pdo, $auth, 'announcement.create', [
            'summary' => 'Comunicado creado: ' . $title,
            'entity_type' => 'announcements',
            'entity_id' => $id,
        ]);
        Response::created(self::normalizeRow($row ?: []), 'Comunicado creado');
    }

    public static function update(int $id): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'announcements')) {
            Response::error('Sin permiso para editar comunicados.', 403);
            return;
        }
        $body = self::readBody();
        $title = trim((string) ($body['title'] ?? ''));
        $message = trim((string) ($body['message'] ?? ''));
        if ($title === '' || $message === '') {
            Response::error('Título y mensaje son obligatorios.', 400);
            return;
        }

        $pdo = getDbConnection();
        self::ensureTable($pdo);

        $stmt = $pdo->prepare(
            'UPDATE announcements
             SET title = ?, message = ?, start_at = ?, end_at = ?, cta_label = ?, cta_url = ?, image_url = ?, is_active = ?
             WHERE id = ?'
        );
        $stmt->execute([
            $title,
            $message,
            self::parseNullableDateTime($body['start_at'] ?? null),
            self::parseNullableDateTime($body['end_at'] ?? null),
            (($x = trim((string) ($body['cta_label'] ?? ''))) === '' ? null : $x),
            (($x = trim((string) ($body['cta_url'] ?? ''))) === '' ? null : $x),
            (($x = trim((string) ($body['image_url'] ?? ''))) === '' ? null : $x),
            !empty($body['is_active']) ? 1 : 0,
            $id,
        ]);

        $q = $pdo->prepare('SELECT * FROM announcements WHERE id = ? LIMIT 1');
        $q->execute([$id]);
        $row = $q->fetch(\PDO::FETCH_ASSOC);
        if (!$row) {
            Response::notFound('Comunicado no encontrado.');
            return;
        }
        recordEventLog($pdo, $auth, 'announcement.update', [
            'summary' => 'Comunicado actualizado: ' . $title,
            'entity_type' => 'announcements',
            'entity_id' => $id,
        ]);
        Response::success(self::normalizeRow($row), 'Comunicado actualizado');
    }

    public static function destroy(int $id): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'announcements')) {
            Response::error('Sin permiso para inhabilitar comunicados.', 403);
            return;
        }
        $pdo = getDbConnection();
        self::ensureTable($pdo);
        $stmt = $pdo->prepare('UPDATE announcements SET is_active = 0 WHERE id = ?');
        $stmt->execute([$id]);
        Response::success(null, 'Comunicado inhabilitado');
    }

    public static function uploadImage(): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'announcements')) {
            Response::error('Sin permiso para subir imagenes.', 403);
            return;
        }

        $file = $_FILES['file'] ?? null;
        if (!$file || !isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            Response::error('No se ha subido ningun archivo.', 400);
            return;
        }

        $allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
        $maxSizeBytes = 8 * 1024 * 1024; // 8 MB
        $ext = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
        if ($ext === '' || !in_array($ext, $allowedExts, true)) {
            Response::error('Formato no permitido. Use JPG, PNG, WEBP o GIF.', 400);
            return;
        }
        if (($file['size'] ?? 0) > $maxSizeBytes) {
            Response::error('La imagen no debe superar 8 MB.', 400);
            return;
        }

        $baseDir = __DIR__ . '/../uploads/public/announcements/';
        if (!is_dir($baseDir) && !@mkdir($baseDir, 0755, true)) {
            Response::error('Error al crear directorio de almacenamiento.', 500);
            return;
        }

        $filename = date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
        $filepath = $baseDir . $filename;
        if (!move_uploaded_file($file['tmp_name'], $filepath)) {
            Response::error('Error al guardar la imagen.', 500);
            return;
        }

        $url = '/uploads/public/announcements/' . $filename;
        Response::json([
            'success' => true,
            'data' => ['url' => $url, 'ext' => $ext]
        ]);
    }
}

