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

    private static function legacyStoragePath(): string
    {
        return __DIR__ . '/../storage/readonly_documents.json';
    }

    private static function ensureTables(\PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS `readonly_settings` (
                `id` TINYINT UNSIGNED NOT NULL,
                `authorization_url` VARCHAR(600) NOT NULL DEFAULT \'\',
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS `readonly_documents` (
                `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                `title` VARCHAR(180) NOT NULL,
                `url` VARCHAR(600) NOT NULL,
                `description` VARCHAR(500) DEFAULT NULL,
                `doc_date` DATE DEFAULT NULL,
                `sort_order` INT NOT NULL DEFAULT 0,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                KEY `idx_readonly_docs_sort` (`sort_order`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS `tutorial_topics` (
                `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                `title` VARCHAR(180) NOT NULL,
                `description` TEXT DEFAULT NULL,
                `sort_order` INT NOT NULL DEFAULT 0,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                KEY `idx_tutorial_topics_sort` (`sort_order`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS `tutorial_videos` (
                `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                `topic_id` INT UNSIGNED NOT NULL,
                `title` VARCHAR(180) NOT NULL,
                `youtube_id` VARCHAR(64) NOT NULL,
                `sort_order` INT NOT NULL DEFAULT 0,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                KEY `idx_tutorial_videos_topic` (`topic_id`),
                KEY `idx_tutorial_videos_sort` (`sort_order`),
                CONSTRAINT `fk_tutorial_videos_topic`
                    FOREIGN KEY (`topic_id`) REFERENCES `tutorial_topics` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS `emergency_contacts` (
                `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                `label` VARCHAR(180) NOT NULL,
                `phone` VARCHAR(40) NOT NULL DEFAULT \'\',
                `detail` VARCHAR(500) DEFAULT NULL,
                `sort_order` INT NOT NULL DEFAULT 0,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                KEY `idx_emergency_contacts_sort` (`sort_order`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    private static function isContentEmpty(\PDO $pdo): bool
    {
        $docs = (int) $pdo->query('SELECT COUNT(*) FROM readonly_documents')->fetchColumn();
        $topics = (int) $pdo->query('SELECT COUNT(*) FROM tutorial_topics')->fetchColumn();
        $contacts = (int) $pdo->query('SELECT COUNT(*) FROM emergency_contacts')->fetchColumn();
        $settings = (int) $pdo->query('SELECT COUNT(*) FROM readonly_settings')->fetchColumn();
        return $docs === 0 && $topics === 0 && $contacts === 0 && $settings === 0;
    }

    private static function readJsonSeed(): ?array
    {
        $paths = [self::storagePath(), self::legacyStoragePath()];
        foreach ($paths as $path) {
            if (!is_file($path) || !is_readable($path)) {
                continue;
            }
            $raw = file_get_contents($path);
            $data = json_decode($raw ?: '{}', true);
            if (is_array($data)) {
                return $data;
            }
        }
        return null;
    }

    private static function importFromJsonIfEmpty(\PDO $pdo): void
    {
        if (!self::isContentEmpty($pdo)) {
            return;
        }
        $data = self::readJsonSeed();
        if ($data === null) {
            $pdo->prepare('INSERT INTO readonly_settings (id, authorization_url) VALUES (1, ?)')
                ->execute(['']);
            return;
        }

        $authUrl = trim((string) ($data['authorization_url'] ?? ''));
        $pdo->prepare('INSERT INTO readonly_settings (id, authorization_url) VALUES (1, ?)')
            ->execute([$authUrl]);

        $docs = self::normalizeDocs($data['documents'] ?? []);
        self::replaceDocuments($pdo, $docs);

        $topics = self::normalizeTopics($data['tutorial_topics'] ?? []);
        self::replaceTutorials($pdo, $topics);

        $contacts = self::normalizeContacts($data['emergency_contacts'] ?? []);
        self::replaceContacts($pdo, $contacts);
    }

    private static function normalizeDocs($docs): array
    {
        if (!is_array($docs)) {
            return [];
        }
        $out = [];
        foreach ($docs as $d) {
            if (!is_array($d)) {
                continue;
            }
            $title = trim((string) ($d['title'] ?? ''));
            $url = trim((string) ($d['url'] ?? ''));
            $description = trim((string) ($d['description'] ?? ''));
            $date = trim((string) ($d['date'] ?? $d['doc_date'] ?? ''));
            if ($title === '' || $url === '') {
                continue;
            }
            $item = [
                'title' => $title,
                'url' => $url,
                'description' => ($description === '' ? null : $description),
            ];
            if ($date !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                $item['date'] = $date;
            }
            $out[] = $item;
        }
        return $out;
    }

    private static function normalizeYoutubeId(string $raw): string
    {
        $id = trim($raw);
        if ($id === '') {
            return '';
        }
        if (preg_match('/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/', $id, $m)) {
            return $m[1];
        }
        // Quitar query params residuales tipo id&t=3s
        $id = preg_replace('/[?&].*$/', '', $id) ?? $id;
        $id = preg_replace('/[^A-Za-z0-9_-]/', '', $id) ?? $id;
        return $id;
    }

    private static function normalizeTopics($topics): array
    {
        if (!is_array($topics)) {
            return [];
        }
        $out = [];
        foreach ($topics as $topic) {
            if (!is_array($topic)) {
                continue;
            }
            $title = trim((string) ($topic['title'] ?? ''));
            if ($title === '') {
                continue;
            }
            $description = trim((string) ($topic['description'] ?? ''));
            $videos = [];
            $rawVideos = $topic['videos'] ?? [];
            if (is_array($rawVideos)) {
                foreach ($rawVideos as $v) {
                    if (!is_array($v)) {
                        continue;
                    }
                    $vTitle = trim((string) ($v['title'] ?? ''));
                    $youtubeId = self::normalizeYoutubeId((string) ($v['youtubeId'] ?? $v['youtube_id'] ?? ''));
                    if ($vTitle === '' || $youtubeId === '') {
                        continue;
                    }
                    $videos[] = [
                        'title' => $vTitle,
                        'youtubeId' => $youtubeId,
                    ];
                }
            }
            $out[] = [
                'title' => $title,
                'description' => ($description === '' ? null : $description),
                'videos' => $videos,
            ];
        }
        return $out;
    }

    private static function normalizeContacts($contacts): array
    {
        if (!is_array($contacts)) {
            return [];
        }
        $out = [];
        foreach ($contacts as $c) {
            if (!is_array($c)) {
                continue;
            }
            $label = trim((string) ($c['label'] ?? ''));
            $phone = trim((string) ($c['phone'] ?? ''));
            $detail = trim((string) ($c['detail'] ?? ''));
            if ($label === '') {
                continue;
            }
            $out[] = [
                'label' => $label,
                'phone' => $phone,
                'detail' => ($detail === '' ? null : $detail),
            ];
        }
        return $out;
    }

    private static function replaceDocuments(\PDO $pdo, array $docs): void
    {
        $pdo->exec('DELETE FROM readonly_documents');
        $stmt = $pdo->prepare(
            'INSERT INTO readonly_documents (title, url, description, doc_date, sort_order)
             VALUES (?, ?, ?, ?, ?)'
        );
        foreach ($docs as $i => $d) {
            $date = $d['date'] ?? null;
            if (!is_string($date) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                $date = null;
            }
            $stmt->execute([
                $d['title'],
                $d['url'],
                $d['description'] ?? null,
                $date,
                $i,
            ]);
        }
    }

    private static function replaceTutorials(\PDO $pdo, array $topics): void
    {
        $pdo->exec('DELETE FROM tutorial_videos');
        $pdo->exec('DELETE FROM tutorial_topics');
        $topicStmt = $pdo->prepare(
            'INSERT INTO tutorial_topics (title, description, sort_order) VALUES (?, ?, ?)'
        );
        $videoStmt = $pdo->prepare(
            'INSERT INTO tutorial_videos (topic_id, title, youtube_id, sort_order) VALUES (?, ?, ?, ?)'
        );
        foreach ($topics as $i => $topic) {
            $topicStmt->execute([
                $topic['title'],
                $topic['description'] ?? null,
                $i,
            ]);
            $topicId = (int) $pdo->lastInsertId();
            $videos = $topic['videos'] ?? [];
            foreach ($videos as $j => $v) {
                $videoStmt->execute([
                    $topicId,
                    $v['title'],
                    $v['youtubeId'],
                    $j,
                ]);
            }
        }
    }

    private static function replaceContacts(\PDO $pdo, array $contacts): void
    {
        $pdo->exec('DELETE FROM emergency_contacts');
        $stmt = $pdo->prepare(
            'INSERT INTO emergency_contacts (label, phone, detail, sort_order) VALUES (?, ?, ?, ?)'
        );
        foreach ($contacts as $i => $c) {
            $stmt->execute([
                $c['label'],
                $c['phone'] ?? '',
                $c['detail'] ?? null,
                $i,
            ]);
        }
    }

    private static function loadAuthorizationUrl(\PDO $pdo): string
    {
        $stmt = $pdo->query('SELECT authorization_url FROM readonly_settings WHERE id = 1 LIMIT 1');
        $row = $stmt ? $stmt->fetch(\PDO::FETCH_ASSOC) : false;
        if (!$row) {
            $pdo->prepare('INSERT INTO readonly_settings (id, authorization_url) VALUES (1, ?)')->execute(['']);
            return '';
        }
        return trim((string) ($row['authorization_url'] ?? ''));
    }

    private static function loadDocuments(\PDO $pdo): array
    {
        $stmt = $pdo->query(
            'SELECT title, url, description, doc_date
             FROM readonly_documents
             ORDER BY sort_order ASC, id ASC'
        );
        $rows = $stmt ? $stmt->fetchAll(\PDO::FETCH_ASSOC) : [];
        $out = [];
        foreach ($rows as $row) {
            $item = [
                'title' => (string) ($row['title'] ?? ''),
                'url' => (string) ($row['url'] ?? ''),
                'description' => isset($row['description']) && $row['description'] !== null && $row['description'] !== ''
                    ? (string) $row['description']
                    : null,
            ];
            if (!empty($row['doc_date'])) {
                $item['date'] = (string) $row['doc_date'];
            }
            $out[] = $item;
        }
        return $out;
    }

    private static function loadTopics(\PDO $pdo): array
    {
        $topicStmt = $pdo->query(
            'SELECT id, title, description
             FROM tutorial_topics
             ORDER BY sort_order ASC, id ASC'
        );
        $topics = $topicStmt ? $topicStmt->fetchAll(\PDO::FETCH_ASSOC) : [];
        if ($topics === []) {
            return [];
        }

        $videoStmt = $pdo->prepare(
            'SELECT title, youtube_id
             FROM tutorial_videos
             WHERE topic_id = ?
             ORDER BY sort_order ASC, id ASC'
        );
        $out = [];
        foreach ($topics as $topic) {
            $videoStmt->execute([(int) $topic['id']]);
            $videos = [];
            foreach ($videoStmt->fetchAll(\PDO::FETCH_ASSOC) as $v) {
                $videos[] = [
                    'title' => (string) ($v['title'] ?? ''),
                    'youtubeId' => (string) ($v['youtube_id'] ?? ''),
                ];
            }
            $desc = $topic['description'] ?? null;
            $out[] = [
                'title' => (string) ($topic['title'] ?? ''),
                'description' => ($desc !== null && $desc !== '' ? (string) $desc : null),
                'videos' => $videos,
            ];
        }
        return $out;
    }

    private static function loadContacts(\PDO $pdo): array
    {
        $stmt = $pdo->query(
            'SELECT label, phone, detail
             FROM emergency_contacts
             ORDER BY sort_order ASC, id ASC'
        );
        $rows = $stmt ? $stmt->fetchAll(\PDO::FETCH_ASSOC) : [];
        $out = [];
        foreach ($rows as $row) {
            $detail = $row['detail'] ?? null;
            $out[] = [
                'label' => (string) ($row['label'] ?? ''),
                'phone' => (string) ($row['phone'] ?? ''),
                'detail' => ($detail !== null && $detail !== '' ? (string) $detail : null),
            ];
        }
        return $out;
    }

    private static function loadAll(\PDO $pdo): array
    {
        self::ensureTables($pdo);
        self::importFromJsonIfEmpty($pdo);

        return [
            'tutorial_topics' => self::loadTopics($pdo),
            'documents' => self::loadDocuments($pdo),
            'authorization_url' => self::loadAuthorizationUrl($pdo),
            'emergency_contacts' => self::loadContacts($pdo),
            'announcements' => [],
        ];
    }

    public static function index(): void
    {
        requireAuth();
        $pdo = getDbConnection();
        $data = self::loadAll($pdo);
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

        $pdo = getDbConnection();
        self::ensureTables($pdo);
        self::importFromJsonIfEmpty($pdo);

        $docs = self::normalizeDocs($body['documents'] ?? []);
        $authUrl = trim((string) ($body['authorization_url'] ?? ''));

        try {
            $pdo->beginTransaction();
            self::replaceDocuments($pdo, $docs);
            $pdo->prepare(
                'INSERT INTO readonly_settings (id, authorization_url) VALUES (1, ?)
                 ON DUPLICATE KEY UPDATE authorization_url = VALUES(authorization_url)'
            )->execute([$authUrl]);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            Response::error('No se pudo guardar documentos.', 500);
            return;
        }

        $data = self::loadAll($pdo);
        recordEventLog($pdo, $auth, 'readonly_documents.update', [
            'summary' => 'Documentos de solo lectura actualizados',
            'entity_type' => 'readonly_documents',
            'details' => ['documents_count' => count($data['documents'] ?? [])],
        ]);

        Response::json(['success' => true, 'data' => $data]);
    }

    public static function updateTutorials(): void
    {
        $auth = requireAuth();
        if (!isAdminRole($auth)) {
            Response::error('Solo administradores pueden editar tutoriales.', 403);
            return;
        }

        $raw = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);
        if (!is_array($body)) {
            Response::error('JSON inválido', 400);
            return;
        }

        $pdo = getDbConnection();
        self::ensureTables($pdo);
        self::importFromJsonIfEmpty($pdo);

        $topics = self::normalizeTopics($body['tutorial_topics'] ?? []);

        try {
            $pdo->beginTransaction();
            self::replaceTutorials($pdo, $topics);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            Response::error('No se pudo guardar tutoriales.', 500);
            return;
        }

        $data = self::loadAll($pdo);
        recordEventLog($pdo, $auth, 'readonly_tutorials.update', [
            'summary' => 'Tutoriales actualizados',
            'entity_type' => 'tutorial_topics',
            'details' => ['topics_count' => count($data['tutorial_topics'] ?? [])],
        ]);

        Response::json(['success' => true, 'data' => $data]);
    }

    public static function updateEmergencyContacts(): void
    {
        $auth = requireAuth();
        if (!isAdminRole($auth)) {
            Response::error('Solo administradores pueden editar contactos de emergencia.', 403);
            return;
        }

        $raw = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);
        if (!is_array($body)) {
            Response::error('JSON inválido', 400);
            return;
        }

        $pdo = getDbConnection();
        self::ensureTables($pdo);
        self::importFromJsonIfEmpty($pdo);

        $contacts = self::normalizeContacts($body['emergency_contacts'] ?? []);

        try {
            $pdo->beginTransaction();
            self::replaceContacts($pdo, $contacts);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            Response::error('No se pudo guardar contactos.', 500);
            return;
        }

        $data = self::loadAll($pdo);
        recordEventLog($pdo, $auth, 'readonly_emergency_contacts.update', [
            'summary' => 'Contactos de emergencia actualizados',
            'entity_type' => 'emergency_contacts',
            'details' => ['contacts_count' => count($data['emergency_contacts'] ?? [])],
        ]);

        Response::json(['success' => true, 'data' => $data]);
    }

    /**
     * Upload de documento para listado por URL.
     * Importante: NO existe endpoint de borrado: al "quitar" la URL del listado solo
     * se elimina la referencia en BD; el archivo subido permanece en el servidor.
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
