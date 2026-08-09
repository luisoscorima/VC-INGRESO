<?php

/**
 * Consulta RENIEC sin exponer la credencial al navegador.
 *
 * @return array<string,mixed>|null Datos normalizados o null si no se encontró.
 */
function reniec_lookup_dni(string $dni): ?array
{
    if (!preg_match('/^[0-9]{8}$/', $dni)) {
        throw new \InvalidArgumentException('DNI inválido');
    }
    $token = trim((string) (getenv('RENIEC_API_TOKEN') ?: ''));
    if ($token === '') {
        throw new \RuntimeException('RENIEC no configurado', 502);
    }

    $url = 'https://my.apidev.pro/api/dni/' . rawurlencode($dni);
    $status = 0;
    $body = '';

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $token],
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $response = curl_exec($curl);
        if ($response === false) {
            $error = curl_error($curl);
            curl_close($curl);
            throw new \RuntimeException('RENIEC no disponible: ' . $error, 504);
        }
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $body = (string) $response;
        curl_close($curl);
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "Accept: application/json\r\nAuthorization: Bearer {$token}\r\n",
                'timeout' => 5,
                'ignore_errors' => true,
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $response = @file_get_contents($url, false, $context);
        if ($response === false) {
            throw new \RuntimeException('RENIEC no disponible', 504);
        }
        $body = (string) $response;
        $statusLine = $http_response_header[0] ?? '';
        if (preg_match('/\s(\d{3})\s/', $statusLine, $match)) {
            $status = (int) $match[1];
        }
    }

    if ($status === 404) {
        return null;
    }
    if ($status === 429) {
        throw new \RuntimeException('Límite de RENIEC alcanzado', 429);
    }
    if ($status < 200 || $status >= 300) {
        throw new \RuntimeException('Respuesta inválida de RENIEC', 502);
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        throw new \RuntimeException('Respuesta inválida de RENIEC', 502);
    }
    $data = isset($decoded['data']) && is_array($decoded['data']) ? $decoded['data'] : $decoded;
    $normalized = [
        'numero' => trim((string) ($data['numero'] ?? $data['dni'] ?? $dni)),
        'nombres' => trim((string) ($data['nombres'] ?? $data['first_name'] ?? '')),
        'apellido_paterno' => trim((string) ($data['apellido_paterno'] ?? $data['paternal_surname'] ?? '')),
        'apellido_materno' => trim((string) ($data['apellido_materno'] ?? $data['maternal_surname'] ?? '')),
        'sexo' => trim((string) ($data['sexo'] ?? '')),
        'fecha_nacimiento' => trim((string) ($data['fecha_nacimiento'] ?? '')),
        'estado_civil' => trim((string) ($data['estado_civil'] ?? '')),
        'direccion_completa' => trim((string) ($data['direccion_completa'] ?? $data['direccion'] ?? '')),
        'distrito' => trim((string) ($data['distrito'] ?? '')),
        'provincia' => trim((string) ($data['provincia'] ?? '')),
        'departamento' => trim((string) ($data['departamento'] ?? '')),
    ];
    if ($normalized['nombres'] === '' && $normalized['apellido_paterno'] === '') {
        return null;
    }
    return $normalized;
}

