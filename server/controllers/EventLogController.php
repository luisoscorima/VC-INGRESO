<?php

namespace Controllers;

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../helpers/house_permissions.php';
require_once __DIR__ . '/../helpers/event_log.php';

use Utils\Response;

class EventLogController extends Controller
{
    private const MAX_PAGE_SIZE = 200;
    private const RETENTION_DAYS = 30;

    /**
     * GET /api/v1/admin/event-logs/actions
     */
    public function actionsCatalog(): void
    {
        $auth = requireAuth();
        if (!isAdminRole($auth)) {
            Response::error('Solo administradores pueden consultar el registro de eventos', 403);

            return;
        }

        Response::success(['actions' => getEventLogActionCatalog($this->db)]);
    }

    /**
     * GET /api/v1/admin/event-logs
     */
    public function index(): void
    {
        $auth = requireAuth();
        if (!isAdminRole($auth)) {
            Response::error('Solo administradores pueden consultar el registro de eventos', 403);

            return;
        }

        $params = $_GET;
        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = min(self::MAX_PAGE_SIZE, max(1, (int) ($params['page_size'] ?? 50)));
        $offset = ($page - 1) * $pageSize;

        $minDate = date('Y-m-d 00:00:00', strtotime('-' . self::RETENTION_DAYS . ' days'));
        $from = trim((string) ($params['from'] ?? ''));
        $to = trim((string) ($params['to'] ?? ''));

        if ($from === '') {
            $from = date('Y-m-d 00:00:00', strtotime('-7 days'));
        } else {
            $from = $this->normalizeDateTimeParam($from, true);
        }

        if ($to === '') {
            $to = date('Y-m-d 23:59:59');
        } else {
            $to = $this->normalizeDateTimeParam($to, false);
        }

        if ($from < $minDate) {
            $from = $minDate;
        }

        $where = ['occurred_at >= ?', 'occurred_at <= ?'];
        $bind = [$from, $to];

        $action = trim((string) ($params['action'] ?? ''));
        if ($action !== '') {
            $where[] = 'action = ?';
            $bind[] = $action;
        }

        $entityType = trim((string) ($params['entity_type'] ?? ''));
        if ($entityType !== '') {
            $where[] = 'entity_type = ?';
            $bind[] = $entityType;
        }

        $actorUserId = (int) ($params['actor_user_id'] ?? 0);
        if ($actorUserId > 0) {
            $where[] = 'actor_user_id = ?';
            $bind[] = $actorUserId;
        }

        $q = trim((string) ($params['q'] ?? ''));
        if ($q !== '') {
            $where[] = '(summary LIKE ? OR actor_username LIKE ? OR action LIKE ?)';
            $like = '%' . $q . '%';
            $bind[] = $like;
            $bind[] = $like;
            $bind[] = $like;
        }

        $whereSql = implode(' AND ', $where);

        $countStmt = $this->db->prepare("SELECT COUNT(*) FROM event_logs WHERE {$whereSql}");
        $countStmt->execute($bind);
        $total = (int) $countStmt->fetchColumn();

        $sql = "SELECT id, occurred_at, actor_user_id, actor_role, actor_username,
                       action, entity_type, entity_id, summary, details_json,
                       ip_address, user_agent
                FROM event_logs
                WHERE {$whereSql}
                ORDER BY occurred_at DESC, id DESC
                LIMIT " . (int) $pageSize . ' OFFSET ' . (int) $offset;

        $stmt = $this->db->prepare($sql);
        $stmt->execute($bind);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        foreach ($rows as &$row) {
            if (!empty($row['details_json']) && is_string($row['details_json'])) {
                $decoded = json_decode($row['details_json'], true);
                $row['details_json'] = $decoded !== null ? $decoded : $row['details_json'];
            }
        }
        unset($row);

        Response::success([
            'items' => $rows,
            'pagination' => [
                'page' => $page,
                'page_size' => $pageSize,
                'total' => $total,
                'total_pages' => $pageSize > 0 ? (int) ceil($total / $pageSize) : 0,
            ],
            'filters' => [
                'from' => $from,
                'to' => $to,
                'retention_days' => self::RETENTION_DAYS,
            ],
        ]);
    }

    private function normalizeDateTimeParam(string $value, bool $startOfDay): string
    {
        $value = trim($value);
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return $startOfDay ? $value . ' 00:00:00' : $value . ' 23:59:59';
        }
        $ts = strtotime($value);

        return $ts !== false ? date('Y-m-d H:i:s', $ts) : ($startOfDay ? date('Y-m-d 00:00:00') : date('Y-m-d 23:59:59'));
    }
}
