<?php
/**
 * Migra archivos bajo server/uploads a S3 (mismo mapeo que upload_storage.php).
 * No altera la BD.
 *
 * Uso (dentro del contenedor api, con STORAGE_DRIVER=s3 y credenciales):
 *   php scripts/migrate-uploads-to-s3.php --dry-run
 *   php scripts/migrate-uploads-to-s3.php
 *
 * En Docker el script suele montarse o copiarse; por defecto busca /var/www/html/uploads.
 */

declare(strict_types=1);

$dryRun = in_array('--dry-run', $argv, true);

$root = dirname(__DIR__);
$envFile = is_readable($root . '/.env') ? $root . '/.env' : (is_readable($root . '/server/.env') ? $root . '/server/.env' : null);
if ($envFile) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) {
            continue;
        }
        [$name, $value] = explode('=', $line, 2);
        $name = trim($name);
        $value = trim($value, " \t\n\r\0\x0B\"'");
        if ($name !== '' && getenv($name) === false) {
            putenv("$name=$value");
            $_ENV[$name] = $value;
        }
    }
}

$uploadsDir = is_dir('/var/www/html/uploads')
    ? '/var/www/html/uploads'
    : $root . '/server/uploads';

$helper = is_readable('/var/www/html/helpers/upload_storage.php')
    ? '/var/www/html/helpers/upload_storage.php'
    : $root . '/server/helpers/upload_storage.php';

$autoload = is_readable('/var/www/html/vendor/autoload.php')
    ? '/var/www/html/vendor/autoload.php'
    : $root . '/server/vendor/autoload.php';

if (is_readable($autoload)) {
    require_once $autoload;
}
require_once $helper;

if (!is_dir($uploadsDir)) {
    fwrite(STDERR, "No existe uploads: {$uploadsDir}\n");
    exit(1);
}

echo "Origen: {$uploadsDir}\n";
echo 'Bucket: ' . s3Bucket() . '  prefix: ' . s3KeyPrefix() . "\n";
if ($dryRun) {
    echo "MODO DRY-RUN\n";
}

$ok = 0;
$fail = 0;
$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($uploadsDir, FilesystemIterator::SKIP_DOTS)
);

foreach ($it as $fileInfo) {
    /** @var SplFileInfo $fileInfo */
    if (!$fileInfo->isFile()) {
        continue;
    }
    $full = $fileInfo->getPathname();
    $rel = str_replace('\\', '/', substr($full, strlen(rtrim($uploadsDir, '/\\'))));
    $rel = ltrim($rel, '/');
    $storedPath = '/uploads/' . $rel;
    $key = storedPathToS3Key($storedPath);
    if ($key === null) {
        fwrite(STDERR, "SKIP (sin mapeo): {$storedPath}\n");
        continue;
    }

    if ($dryRun) {
        echo "WOULD UPLOAD  {$storedPath}  →  s3://" . s3Bucket() . "/{$key}\n";
        $ok++;
        continue;
    }

    $ctype = function_exists('mime_content_type') ? (@mime_content_type($full) ?: null) : null;
    if (putStoredFileToS3($full, $storedPath, $ctype)) {
        echo "OK  {$storedPath}\n";
        $ok++;
    } else {
        fwrite(STDERR, "FAIL  {$storedPath}\n");
        $fail++;
    }
}

echo "Done. ok={$ok} fail={$fail}\n";
exit($fail > 0 ? 1 : 0);
