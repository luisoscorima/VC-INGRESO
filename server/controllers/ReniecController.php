<?php

namespace Controllers;

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/reniec.php';
require_once __DIR__ . '/../utils/Response.php';

use Utils\Response;

class ReniecController
{
    public function lookup(string $dni): void
    {
        requireAuth();
        $this->respond($dni);
    }

    public function publicLookup(string $dni): void
    {
        if (!$this->consumePublicRateLimit()) {
            Response::error('Demasiadas consultas. Intente nuevamente más tarde.', 429);
            return;
        }
        $this->respond($dni);
    }

    private function respond(string $dni): void
    {
        header('Cache-Control: no-store');
        if (!preg_match('/^[0-9]{8}$/', $dni)) {
            Response::error('DNI inválido', 400);
            return;
        }
        try {
            $data = reniec_lookup_dni($dni);
            if (!$data) {
                Response::error('DNI no encontrado', 404);
                return;
            }
            Response::success($data, 'Identidad encontrada');
        } catch (\InvalidArgumentException $e) {
            Response::error('DNI inválido', 400);
        } catch (\RuntimeException $e) {
            $status = in_array($e->getCode(), [429, 502, 504], true) ? $e->getCode() : 502;
            error_log('RENIEC proxy error: ' . $e->getMessage());
            Response::error($status === 429 ? 'Límite del proveedor alcanzado' : 'RENIEC no disponible', $status);
        }
    }

    private function consumePublicRateLimit(): bool
    {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $bucket = date('YmdHi');
        $file = sys_get_temp_dir() . '/vc-reniec-' . hash('sha256', $ip . '|' . $bucket);
        $handle = @fopen($file, 'c+');
        if (!$handle) {
            return false;
        }
        try {
            if (!flock($handle, LOCK_EX)) return false;
            $raw = stream_get_contents($handle);
            $count = max(0, (int) $raw);
            if ($count >= 10) return false;
            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, (string) ($count + 1));
            fflush($handle);
            return true;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}

