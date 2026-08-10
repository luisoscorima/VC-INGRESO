<?php
/**
 * Almacenamiento de archivos subidos (fotos / documentos).
 * STORAGE_DRIVER=local (default) | s3
 *
 * En BD se guardan paths relativos estables (/uploads/...).
 * resolveMediaUrl() expone URL pública S3 cuando aplica (listo para URLs firmadas después).
 */

if (!function_exists('storageDriver')) {
    function storageDriver(): string
    {
        $d = strtolower(trim((string) (getenv('STORAGE_DRIVER') ?: 'local')));
        return $d === 's3' ? 's3' : 'local';
    }
}

if (!function_exists('storageEnv')) {
    function storageEnv(string $key, string $default = ''): string
    {
        $v = getenv($key);
        if ($v === false || $v === null) {
            return $default;
        }
        return trim((string) $v);
    }
}

if (!function_exists('ensureComposerAutoload')) {
    function ensureComposerAutoload(): void
    {
        static $loaded = false;
        if ($loaded) {
            return;
        }
        $autoload = __DIR__ . '/../vendor/autoload.php';
        if (is_readable($autoload)) {
            require_once $autoload;
        }
        $loaded = true;
    }
}

if (!function_exists('getS3Client')) {
    /**
     * @return \Aws\S3\S3Client|null
     */
    function getS3Client()
    {
        ensureComposerAutoload();
        if (!class_exists(\Aws\S3\S3Client::class)) {
            return null;
        }
        $region = storageEnv('AWS_REGION', 'us-east-1');
        $key = storageEnv('AWS_ACCESS_KEY_ID');
        $secret = storageEnv('AWS_SECRET_ACCESS_KEY');
        $config = [
            'version' => 'latest',
            'region' => $region,
        ];
        if ($key !== '' && $secret !== '') {
            $config['credentials'] = [
                'key' => $key,
                'secret' => $secret,
            ];
        }
        return new \Aws\S3\S3Client($config);
    }
}

if (!function_exists('s3Bucket')) {
    function s3Bucket(): string
    {
        return storageEnv('S3_BUCKET', 'crearttech-storage');
    }
}

if (!function_exists('s3KeyPrefix')) {
    function s3KeyPrefix(): string
    {
        return trim(storageEnv('S3_KEY_PREFIX', 'vc-ingreso'), '/');
    }
}

if (!function_exists('s3MediaPublicBaseUrl')) {
    function s3MediaPublicBaseUrl(): string
    {
        return rtrim(storageEnv('S3_MEDIA_PUBLIC_BASE_URL'), '/');
    }
}

/**
 * Mapea path relativo de BD a key S3 bajo {prefix}/media/...
 *
 * /uploads/incidents/X          → {prefix}/media/incidents/X
 * /uploads/public/{subdir}/X    → {prefix}/media/{subdir}/X
 * /uploads/pets/X               → {prefix}/media/pets/X
 */
if (!function_exists('storedPathToS3Key')) {
    function storedPathToS3Key(string $storedPath): ?string
    {
        $path = '/' . ltrim(str_replace('\\', '/', trim($storedPath)), '/');
        if (str_contains($path, '..')) {
            return null;
        }
        $prefix = s3KeyPrefix();

        if (preg_match('#^/uploads/public/([^/]+)/(.+)$#', $path, $m)) {
            return $prefix . '/media/' . $m[1] . '/' . $m[2];
        }
        if (preg_match('#^/uploads/incidents/(.+)$#', $path, $m)) {
            return $prefix . '/media/incidents/' . $m[1];
        }
        if (preg_match('#^/uploads/pets/(.+)$#', $path, $m)) {
            return $prefix . '/media/pets/' . $m[1];
        }
        if (preg_match('#^/uploads/(.+)$#', $path, $m)) {
            return $prefix . '/media/' . $m[1];
        }

        return null;
    }
}

/**
 * Path relativo estable guardado en BD según directorio lógico.
 *
 * logicalDir:
 *   - "incidents" → /uploads/incidents/{file}
 *   - "pets" (legacy auth) → /uploads/pets/{file}
 *   - "vehicles"|"pets"|"profiles"|... → /uploads/public/{subdir}/{file}
 */
if (!function_exists('logicalDirToStoredPath')) {
    function logicalDirToStoredPath(string $logicalDir, string $filename): string
    {
        $dir = trim($logicalDir, '/');
        if ($dir === 'incidents') {
            return '/uploads/incidents/' . $filename;
        }
        if ($dir === 'pets-legacy' || $dir === 'pets_root') {
            return '/uploads/pets/' . $filename;
        }
        return '/uploads/public/' . $dir . '/' . $filename;
    }
}

if (!function_exists('localPathForStored')) {
    function localPathForStored(string $storedPath): string
    {
        $path = '/' . ltrim(str_replace('\\', '/', $storedPath), '/');
        return __DIR__ . '/..' . $path;
    }
}

if (!function_exists('guessMimeFromExt')) {
    function guessMimeFromExt(string $ext): string
    {
        $map = [
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            'bmp' => 'image/bmp',
            'svg' => 'image/svg+xml',
            'pdf' => 'application/pdf',
            'doc' => 'application/msword',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls' => 'application/vnd.ms-excel',
            'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'txt' => 'text/plain',
            'csv' => 'text/csv',
            'zip' => 'application/zip',
        ];
        return $map[strtolower($ext)] ?? 'application/octet-stream';
    }
}

/**
 * Resuelve path relativo (o URL absoluta) a URL usable en el cliente.
 * Hoy: público S3. Futuro: STORAGE_MEDIA_VISIBILITY=private → URLs firmadas.
 */
if (!function_exists('resolveMediaUrl')) {
    function resolveMediaUrl(?string $storedPath): ?string
    {
        if ($storedPath === null) {
            return null;
        }
        $u = trim($storedPath);
        if ($u === '') {
            return null;
        }
        if (str_starts_with($u, 'http://') || str_starts_with($u, 'https://')) {
            return $u;
        }
        if (str_starts_with($u, '/assets/')) {
            return $u;
        }

        if (storageDriver() !== 's3') {
            return $u;
        }

        $visibility = strtolower(storageEnv('STORAGE_MEDIA_VISIBILITY', 'public'));
        if ($visibility === 'private') {
            // Pendiente: presigned / proxy auth. Mientras tanto devolver path relativo.
            return $u;
        }

        $base = s3MediaPublicBaseUrl();
        $key = storedPathToS3Key($u);
        if ($base === '' || $key === null) {
            return $u;
        }

        // base = .../vc-ingreso/media ; key = vc-ingreso/media/incidents/x.jpg
        $mediaPrefix = s3KeyPrefix() . '/media/';
        $suffix = str_starts_with($key, $mediaPrefix)
            ? substr($key, strlen($mediaPrefix))
            : ltrim($key, '/');

        return $base . '/' . $suffix;
    }
}

if (!function_exists('putStoredFileToS3')) {
    function putStoredFileToS3(string $localFile, string $storedPath, ?string $contentType = null): bool
    {
        $client = getS3Client();
        $key = storedPathToS3Key($storedPath);
        if (!$client || $key === null || !is_readable($localFile)) {
            return false;
        }
        $ext = strtolower(pathinfo($storedPath, PATHINFO_EXTENSION));
        $ctype = $contentType ?: guessMimeFromExt($ext);
        try {
            $client->putObject([
                'Bucket' => s3Bucket(),
                'Key' => $key,
                'SourceFile' => $localFile,
                'ContentType' => $ctype,
                'CacheControl' => 'public, max-age=86400',
            ]);
            return true;
        } catch (\Throwable $e) {
            error_log('S3 putObject failed: ' . $e->getMessage());
            return false;
        }
    }
}

if (!function_exists('deleteStoredMedia')) {
    function deleteStoredMedia(?string $storedPath): void
    {
        if (!$storedPath) {
            return;
        }
        $path = trim($storedPath);
        if ($path === '' || str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return;
        }

        $local = localPathForStored($path);
        $realBase = realpath(__DIR__ . '/../uploads');
        $realFile = realpath($local);
        if ($realBase && $realFile && str_starts_with($realFile, $realBase . DIRECTORY_SEPARATOR) && is_file($realFile)) {
            @unlink($realFile);
        }

        if (storageDriver() === 's3') {
            $client = getS3Client();
            $key = storedPathToS3Key($path);
            if ($client && $key) {
                try {
                    $client->deleteObject([
                        'Bucket' => s3Bucket(),
                        'Key' => $key,
                    ]);
                } catch (\Throwable $e) {
                    error_log('S3 deleteObject failed: ' . $e->getMessage());
                }
            }
        }
    }
}

/**
 * Guarda un archivo subido (elemento $_FILES) en local y/o S3.
 *
 * @param array|null $file Elemento de $_FILES
 * @param string     $logicalDir incidents|vehicles|pets|profiles|camera-access|announcements|readonly-docs|pets_root
 * @param array      $opts allowed_exts?, max_bytes?, filename?, field_required?
 * @return array{success:bool,photo_url:?string,stored_path:?string,error:?string}
 */
if (!function_exists('storeUploadedFile')) {
    function storeUploadedFile($file, string $logicalDir, array $opts = []): array
    {
        $allowedExts = $opts['allowed_exts'] ?? ['jpg', 'jpeg', 'png', 'gif'];
        $maxSizeBytes = (int) ($opts['max_bytes'] ?? (5 * 1024 * 1024));
        $required = array_key_exists('field_required', $opts) ? (bool) $opts['field_required'] : true;

        if (!$file || !isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            return [
                'success' => false,
                'photo_url' => null,
                'stored_path' => null,
                'error' => $required ? 'No se ha subido ninguna imagen' : null,
            ];
        }

        if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
            return [
                'success' => false,
                'photo_url' => null,
                'stored_path' => null,
                'error' => 'Error al subir el archivo (código ' . (int) $file['error'] . ').',
            ];
        }

        $ext = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
        if ($ext === '' || !in_array($ext, $allowedExts, true)) {
            return [
                'success' => false,
                'photo_url' => null,
                'stored_path' => null,
                'error' => 'Formato no permitido.',
            ];
        }

        if (($file['size'] ?? 0) > $maxSizeBytes) {
            return [
                'success' => false,
                'photo_url' => null,
                'stored_path' => null,
                'error' => 'El archivo supera el tamaño máximo permitido.',
            ];
        }

        $filename = $opts['filename'] ?? (date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext);
        $storedPath = logicalDirToStoredPath($logicalDir, $filename);
        $localPath = localPathForStored($storedPath);
        $localDir = dirname($localPath);

        if (!is_dir($localDir) && !@mkdir($localDir, 0755, true)) {
            return [
                'success' => false,
                'photo_url' => null,
                'stored_path' => null,
                'error' => 'Error al crear directorio de almacenamiento.',
            ];
        }

        if (!move_uploaded_file($file['tmp_name'], $localPath)) {
            return [
                'success' => false,
                'photo_url' => null,
                'stored_path' => null,
                'error' => 'Error al guardar el archivo.',
            ];
        }

        if (storageDriver() === 's3') {
            $ctype = null;
            if (is_callable('mime_content_type')) {
                $ctype = @mime_content_type($localPath) ?: null;
            }
            if (!putStoredFileToS3($localPath, $storedPath, $ctype)) {
                @unlink($localPath);
                return [
                    'success' => false,
                    'photo_url' => null,
                    'stored_path' => null,
                    'error' => 'Error al subir el archivo a S3.',
                ];
            }
        }

        return [
            'success' => true,
            'photo_url' => $storedPath,
            'stored_path' => $storedPath,
            'error' => null,
        ];
    }
}

if (!function_exists('storePublicPhoto')) {
    /**
     * Compat: guarda en /uploads/public/{subdir}/
     *
     * @param array|null $file Elemento de $_FILES (ej. $_FILES['photo'])
     * @param string     $subdir 'vehicles', 'pets', 'profiles', 'camera-access', ...
     * @return array ['success' => bool, 'photo_url' => string|null, 'error' => string|null]
     */
    function storePublicPhoto($file, string $subdir, array $opts = []): array
    {
        $defaults = [
            'allowed_exts' => ['jpg', 'jpeg', 'png', 'gif'],
            'max_bytes' => 5 * 1024 * 1024,
        ];
        $result = storeUploadedFile($file, $subdir, array_merge($defaults, $opts));
        return [
            'success' => $result['success'],
            'photo_url' => $result['photo_url'],
            'error' => $result['error'],
        ];
    }
}
