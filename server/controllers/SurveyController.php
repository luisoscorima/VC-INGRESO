<?php

namespace Controllers;

require_once __DIR__ . '/../db_connection.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/nav_permissions.php';
require_once __DIR__ . '/../helpers/event_log.php';
require_once __DIR__ . '/../utils/Response.php';

use Utils\Response;

class SurveyController
{
    private static function ensureQuestionTypeColumn(\PDO $pdo): void
    {
        // Asegura compatibilidad con tipo CHECKBOX en instalaciones existentes.
        $pdo->exec('ALTER TABLE surveys MODIFY COLUMN question_type ENUM("CLOSED","OPEN","MULTIPLE","CHECKBOX") NOT NULL DEFAULT "CLOSED"');
    }

    private static function ensureTables(\PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS surveys (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                title VARCHAR(180) NOT NULL,
                description TEXT DEFAULT NULL,
                question_type ENUM("CLOSED","OPEN","MULTIPLE","CHECKBOX") NOT NULL DEFAULT "CLOSED",
                options_json TEXT DEFAULT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                start_at DATETIME DEFAULT NULL,
                end_at DATETIME DEFAULT NULL,
                created_by_user_id INT UNSIGNED DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_active (is_active),
                KEY idx_start (start_at),
                KEY idx_end (end_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS survey_responses (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                survey_id INT UNSIGNED NOT NULL,
                user_id INT UNSIGNED NOT NULL,
                answer_text TEXT DEFAULT NULL,
                answer_option VARCHAR(255) DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uk_survey_user (survey_id, user_id),
                KEY idx_survey (survey_id),
                KEY idx_user (user_id),
                CONSTRAINT fk_survey_responses_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT fk_survey_responses_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        self::ensureQuestionTypeColumn($pdo);
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
        if ($v === '') return null;
        $ts = strtotime($v);
        if ($ts === false) return null;
        return date('Y-m-d H:i:s', $ts);
    }

    private static function normalizedOptions(string $questionType, $optionsRaw): ?string
    {
        if ($questionType === 'OPEN') {
            return null;
        }
        if ($questionType === 'CLOSED') {
            return json_encode(['Si', 'No', 'Tal vez'], JSON_UNESCAPED_UNICODE);
        }
        $opts = is_array($optionsRaw) ? $optionsRaw : [];
        $clean = [];
        foreach ($opts as $o) {
            $x = trim((string) $o);
            if ($x !== '') $clean[] = $x;
        }
        $clean = array_values(array_unique($clean));
        if (count($clean) < 2) {
            return null;
        }
        return json_encode($clean, JSON_UNESCAPED_UNICODE);
    }

    private static function rowToDto(array $r): array
    {
        $optsRaw = $r['options_json'] ?? null;
        $opts = [];
        if (is_string($optsRaw) && $optsRaw !== '') {
            $tmp = json_decode($optsRaw, true);
            if (is_array($tmp)) $opts = $tmp;
        }
        return [
            'id' => (int) ($r['id'] ?? 0),
            'title' => (string) ($r['title'] ?? ''),
            'description' => (string) ($r['description'] ?? ''),
            'question_type' => (string) ($r['question_type'] ?? 'CLOSED'),
            'options' => $opts,
            'is_active' => ((int) ($r['is_active'] ?? 0)) === 1,
            'start_at' => $r['start_at'] ?? null,
            'end_at' => $r['end_at'] ?? null,
            'created_at' => $r['created_at'] ?? null,
            'updated_at' => $r['updated_at'] ?? null,
            'answers_count' => isset($r['answers_count']) ? (int) $r['answers_count'] : null,
            'has_answered' => isset($r['has_answered']) ? ((int) $r['has_answered']) === 1 : null,
            'option_counts' => isset($r['option_counts']) && is_array($r['option_counts']) ? $r['option_counts'] : null,
        ];
    }

    private static function appendOptionCounts(\PDO $pdo, array $rows): array
    {
        foreach ($rows as &$row) {
            $surveyId = (int) ($row['id'] ?? 0);
            if ($surveyId <= 0) {
                $row['option_counts'] = [];
                continue;
            }
            $type = strtoupper((string) ($row['question_type'] ?? 'CLOSED'));
            $optsRaw = $row['options_json'] ?? '';
            $opts = [];
            if (is_string($optsRaw) && $optsRaw !== '') {
                $arr = json_decode($optsRaw, true);
                if (is_array($arr)) {
                    $opts = array_values($arr);
                }
            }
            $counts = [];
            foreach ($opts as $opt) {
                $counts[(string) $opt] = 0;
            }

            if ($type === 'OPEN') {
                $stmt = $pdo->prepare('SELECT COUNT(*) FROM survey_responses WHERE survey_id = ? AND COALESCE(TRIM(answer_text), "") <> ""');
                $stmt->execute([$surveyId]);
                $otherCount = (int) $stmt->fetchColumn();
                $counts['Otros'] = $otherCount;
                $row['option_counts'] = $counts;
                continue;
            }

            if ($type === 'CHECKBOX') {
                $stmt = $pdo->prepare('SELECT answer_text FROM survey_responses WHERE survey_id = ?');
                $stmt->execute([$surveyId]);
                $resp = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
                $unknown = 0;
                foreach ($resp as $r2) {
                    $arr = json_decode((string) ($r2['answer_text'] ?? ''), true);
                    if (!is_array($arr)) continue;
                    foreach ($arr as $v) {
                        $k = trim((string) $v);
                        if ($k === '') continue;
                        if (!array_key_exists($k, $counts)) {
                            $unknown++;
                            continue;
                        }
                        $counts[$k] = ((int) $counts[$k]) + 1;
                    }
                }
                if ($unknown > 0) {
                    $counts['Otros'] = $unknown;
                }
                $row['option_counts'] = $counts;
                continue;
            }

            $stmt = $pdo->prepare(
                'SELECT answer_option, COUNT(*) AS total
                 FROM survey_responses
                 WHERE survey_id = ?
                 GROUP BY answer_option'
            );
            $stmt->execute([$surveyId]);
            $grouped = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
            $unknown = 0;
            foreach ($grouped as $g) {
                $opt = trim((string) ($g['answer_option'] ?? ''));
                $total = (int) ($g['total'] ?? 0);
                if ($opt === '') continue;
                if (!array_key_exists($opt, $counts)) {
                    $unknown += $total;
                    continue;
                }
                $counts[$opt] = $total;
            }
            if ($unknown > 0) {
                $counts['Otros'] = $unknown;
            }
            $row['option_counts'] = $counts;
        }
        unset($row);
        return $rows;
    }

    public static function index(): void
    {
        $auth = requireAuth();
        if (!canViewModule(getDbConnection(), $auth, 'surveys')) {
            Response::error('Sin permiso para gestionar encuestas.', 403);
            return;
        }
        $pdo = getDbConnection();
        self::ensureTables($pdo);
        $sql = 'SELECT s.*,
                       (SELECT COUNT(*) FROM survey_responses sr WHERE sr.survey_id = s.id) AS answers_count
                FROM surveys s
                ORDER BY COALESCE(s.start_at, s.created_at) DESC, s.id DESC';
        $rows = $pdo->query($sql)->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        $rows = self::appendOptionCounts($pdo, $rows);
        Response::success(array_map([self::class, 'rowToDto'], $rows));
    }

    public static function active(): void
    {
        $auth = requireAuth();
        $userId = (int) ($auth['user_id'] ?? 0);
        if ($userId <= 0) {
            Response::error('Sesion invalida', 401);
            return;
        }
        $pdo = getDbConnection();
        self::ensureTables($pdo);
        $sql = 'SELECT s.*,
                       EXISTS(SELECT 1 FROM survey_responses sr WHERE sr.survey_id = s.id AND sr.user_id = ?) AS has_answered
                FROM surveys s
                WHERE s.is_active = 1
                  AND (s.start_at IS NULL OR s.start_at <= NOW())
                  AND (s.end_at IS NULL OR s.end_at >= NOW())
                ORDER BY COALESCE(s.start_at, s.created_at) DESC, s.id DESC';
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        Response::success(array_map([self::class, 'rowToDto'], $rows));
    }

    public static function store(): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'surveys')) {
            Response::error('Solo administradores pueden crear encuestas.', 403);
            return;
        }
        $body = self::readBody();
        $title = trim((string) ($body['title'] ?? ''));
        $questionType = strtoupper(trim((string) ($body['question_type'] ?? 'CLOSED')));
        $description = trim((string) ($body['description'] ?? ''));
        if ($title === '' || $description === '') {
            Response::error('Titulo y pregunta son obligatorios.', 400);
            return;
        }
        if (!in_array($questionType, ['CLOSED', 'OPEN', 'MULTIPLE', 'CHECKBOX'], true)) {
            Response::error('Tipo de pregunta no valido.', 400);
            return;
        }
        $optionsJson = self::normalizedOptions($questionType, $body['options'] ?? []);
        if (($questionType === 'MULTIPLE' || $questionType === 'CHECKBOX') && $optionsJson === null) {
            Response::error('Defina al menos 2 opciones.', 400);
            return;
        }
        $pdo = getDbConnection();
        self::ensureTables($pdo);
        $stmt = $pdo->prepare(
            'INSERT INTO surveys (title, description, question_type, options_json, is_active, start_at, end_at, created_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $title,
            $description,
            $questionType,
            $optionsJson,
            !empty($body['is_active']) ? 1 : 0,
            self::parseNullableDateTime($body['start_at'] ?? null),
            self::parseNullableDateTime($body['end_at'] ?? null),
            (int) ($auth['user_id'] ?? 0),
        ]);
        $surveyId = (int) $pdo->lastInsertId();
        recordEventLog($pdo, $auth, 'survey.create', [
            'summary' => 'Encuesta creada: ' . $title,
            'entity_type' => 'surveys',
            'entity_id' => $surveyId,
        ]);
        Response::created(['id' => $surveyId], 'Encuesta creada');
    }

    public static function update(int $id): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'surveys')) {
            Response::error('Solo administradores pueden editar encuestas.', 403);
            return;
        }
        $body = self::readBody();
        $title = trim((string) ($body['title'] ?? ''));
        $questionType = strtoupper(trim((string) ($body['question_type'] ?? 'CLOSED')));
        $description = trim((string) ($body['description'] ?? ''));
        if ($title === '' || $description === '') {
            Response::error('Titulo y pregunta son obligatorios.', 400);
            return;
        }
        if (!in_array($questionType, ['CLOSED', 'OPEN', 'MULTIPLE', 'CHECKBOX'], true)) {
            Response::error('Tipo de pregunta no valido.', 400);
            return;
        }
        $optionsJson = self::normalizedOptions($questionType, $body['options'] ?? []);
        if (($questionType === 'MULTIPLE' || $questionType === 'CHECKBOX') && $optionsJson === null) {
            Response::error('Defina al menos 2 opciones.', 400);
            return;
        }
        $pdo = getDbConnection();
        self::ensureTables($pdo);
        $stmt = $pdo->prepare(
            'UPDATE surveys
             SET title = ?, description = ?, question_type = ?, options_json = ?, is_active = ?, start_at = ?, end_at = ?
             WHERE id = ?'
        );
        $stmt->execute([
            $title,
            $description,
            $questionType,
            $optionsJson,
            !empty($body['is_active']) ? 1 : 0,
            self::parseNullableDateTime($body['start_at'] ?? null),
            self::parseNullableDateTime($body['end_at'] ?? null),
            $id,
        ]);
        recordEventLog($pdo, $auth, 'survey.update', [
            'summary' => 'Encuesta actualizada: ' . $title,
            'entity_type' => 'surveys',
            'entity_id' => $id,
        ]);
        Response::success(null, 'Encuesta actualizada');
    }

    public static function destroy(int $id): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'surveys')) {
            Response::error('Solo administradores pueden inhabilitar encuestas.', 403);
            return;
        }
        $pdo = getDbConnection();
        self::ensureTables($pdo);
        $stmt = $pdo->prepare('UPDATE surveys SET is_active = 0 WHERE id = ?');
        $stmt->execute([$id]);
        recordEventLog($pdo, $auth, 'survey.disable', [
            'summary' => 'Encuesta inhabilitada #' . $id,
            'entity_type' => 'surveys',
            'entity_id' => $id,
        ]);
        Response::success(null, 'Encuesta inhabilitada');
    }

    public static function respond(int $id): void
    {
        $auth = requireAuth();
        $userId = (int) ($auth['user_id'] ?? 0);
        if ($userId <= 0) {
            Response::error('Sesion invalida', 401);
            return;
        }
        $body = self::readBody();
        $pdo = getDbConnection();
        self::ensureTables($pdo);

        $q = $pdo->prepare('SELECT * FROM surveys WHERE id = ? LIMIT 1');
        $q->execute([$id]);
        $survey = $q->fetch(\PDO::FETCH_ASSOC);
        if (!$survey) {
            Response::notFound('Encuesta no encontrada.');
            return;
        }
        if ((int) ($survey['is_active'] ?? 0) !== 1) {
            Response::error('Encuesta inactiva.', 400);
            return;
        }

        $type = strtoupper((string) ($survey['question_type'] ?? 'CLOSED'));
        $answerText = null;
        $answerOption = null;
        if ($type === 'OPEN') {
            $answerText = trim((string) ($body['answer_text'] ?? ''));
            if ($answerText === '') {
                Response::error('Respuesta abierta obligatoria.', 400);
                return;
            }
        } elseif ($type === 'CHECKBOX') {
            $answerOptions = is_array($body['answer_options'] ?? null) ? $body['answer_options'] : [];
            $clean = [];
            foreach ($answerOptions as $opt) {
                $x = trim((string) $opt);
                if ($x !== '') $clean[] = $x;
            }
            $clean = array_values(array_unique($clean));
            if (count($clean) === 0) {
                Response::error('Selecciona al menos una opción.', 400);
                return;
            }
            $opts = [];
            $optsRaw = $survey['options_json'] ?? '';
            if (is_string($optsRaw) && $optsRaw !== '') {
                $arr = json_decode($optsRaw, true);
                if (is_array($arr)) $opts = $arr;
            }
            foreach ($clean as $c) {
                if (!in_array($c, $opts, true)) {
                    Response::error('Opcion no valida.', 400);
                    return;
                }
            }
            $answerText = json_encode($clean, JSON_UNESCAPED_UNICODE);
            $answerOption = null;
        } else {
            $answerOption = trim((string) ($body['answer_option'] ?? ''));
            if ($answerOption === '') {
                Response::error('Seleccione una opcion.', 400);
                return;
            }
            $opts = [];
            $optsRaw = $survey['options_json'] ?? '';
            if (is_string($optsRaw) && $optsRaw !== '') {
                $arr = json_decode($optsRaw, true);
                if (is_array($arr)) $opts = $arr;
            }
            if (!in_array($answerOption, $opts, true)) {
                Response::error('Opcion no valida.', 400);
                return;
            }
        }

        $stmt = $pdo->prepare(
            'INSERT INTO survey_responses (survey_id, user_id, answer_text, answer_option)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE answer_text = VALUES(answer_text), answer_option = VALUES(answer_option), updated_at = CURRENT_TIMESTAMP'
        );
        $stmt->execute([$id, $userId, $answerText, $answerOption]);
        Response::success(null, 'Respuesta registrada');
    }

    public static function results(int $id): void
    {
        $auth = requireAuth();
        if (!canManageModule(getDbConnection(), $auth, 'surveys')) {
            Response::error('Solo administradores pueden ver resultados.', 403);
            return;
        }
        $pdo = getDbConnection();
        self::ensureTables($pdo);
        $q = $pdo->prepare('SELECT * FROM surveys WHERE id = ? LIMIT 1');
        $q->execute([$id]);
        $survey = $q->fetch(\PDO::FETCH_ASSOC);
        if (!$survey) {
            Response::notFound('Encuesta no encontrada.');
            return;
        }
        $type = strtoupper((string) ($survey['question_type'] ?? 'CLOSED'));
        if ($type === 'OPEN') {
            $stmt = $pdo->prepare('SELECT user_id, answer_text, created_at FROM survey_responses WHERE survey_id = ? ORDER BY created_at DESC');
            $stmt->execute([$id]);
            $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
            Response::success(['type' => 'OPEN', 'items' => $rows]);
            return;
        }
        if ($type === 'CHECKBOX') {
            $stmt = $pdo->prepare('SELECT answer_text FROM survey_responses WHERE survey_id = ?');
            $stmt->execute([$id]);
            $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
            $counter = [];
            foreach ($rows as $r) {
                $raw = $r['answer_text'] ?? '';
                $arr = json_decode((string) $raw, true);
                if (!is_array($arr)) continue;
                foreach ($arr as $opt) {
                    $k = trim((string) $opt);
                    if ($k === '') continue;
                    $counter[$k] = ($counter[$k] ?? 0) + 1;
                }
            }
            $items = [];
            foreach ($counter as $opt => $total) {
                $items[] = ['answer_option' => $opt, 'total' => (int) $total];
            }
            usort($items, function ($a, $b) {
                return ((int) $b['total']) <=> ((int) $a['total']);
            });
            Response::success(['type' => $type, 'items' => $items]);
            return;
        }

        $stmt = $pdo->prepare(
            'SELECT answer_option, COUNT(*) AS total
             FROM survey_responses
             WHERE survey_id = ?
             GROUP BY answer_option
             ORDER BY total DESC'
        );
        $stmt->execute([$id]);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        Response::success(['type' => $type, 'items' => $rows]);
    }
}

