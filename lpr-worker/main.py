#!/usr/bin/env python3
"""
Worker LPR: captura frames de cámaras IP (HTTP snapshot o RTSP),
OCR con RapidOCR y envía detecciones a la API PHP.
"""

from __future__ import annotations

import base64
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import requests
from rapidocr_onnxruntime import RapidOCR

LOG_LEVEL = os.getenv("LPR_LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("lpr-worker")

API_BASE = os.getenv("LPR_API_BASE_URL", "http://api/api/v1").rstrip("/")
SERVICE_TOKEN = os.getenv("LPR_SERVICE_TOKEN", "").strip()
REFRESH_CAMERAS_SEC = float(os.getenv("LPR_REFRESH_CAMERAS_SEC", "30"))
DEFAULT_POLL_MS = int(os.getenv("LPR_DEFAULT_POLL_MS", "1000"))
JPEG_QUALITY = int(os.getenv("LPR_JPEG_QUALITY", "80"))
REQUEST_TIMEOUT = float(os.getenv("LPR_HTTP_TIMEOUT_SEC", "15"))

# Placas peruanas habituales (tras normalizar sin guiones): ABC123, AB1234, A1B234, etc.
PLATE_CANDIDATE_RE = re.compile(r"^[A-Z0-9]{5,7}$")
PLATE_STRICT_RE = re.compile(
    r"^(?:[A-Z]{3}\d{3}|[A-Z]{2}\d{3,4}|[A-Z]\d[A-Z]\d{3}|[A-Z]{4}\d{2})$"
)


@dataclass
class CameraCfg:
    camera_id: int
    name: str
    stream_url: Optional[str]
    snapshot_url: Optional[str]
    min_confidence: float
    debounce_seconds: int
    poll_interval_ms: int
    direction: str


def normalize_plate(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def api_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {SERVICE_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def fetch_cameras() -> List[CameraCfg]:
    url = f"{API_BASE}/lpr/worker/cameras"
    r = requests.get(url, headers=api_headers(), timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    payload = r.json()
    rows = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return []
    out: List[CameraCfg] = []
    for row in rows:
        try:
            out.append(
                CameraCfg(
                    camera_id=int(row["camera_id"]),
                    name=str(row.get("name") or f"cam-{row['camera_id']}"),
                    stream_url=(str(row["stream_url"]).strip() if row.get("stream_url") else None)
                    or None,
                    snapshot_url=(str(row["snapshot_url"]).strip() if row.get("snapshot_url") else None)
                    or None,
                    min_confidence=float(row.get("min_confidence") or 0.55),
                    debounce_seconds=int(row.get("debounce_seconds") or 30),
                    poll_interval_ms=int(row.get("poll_interval_ms") or DEFAULT_POLL_MS),
                    direction=str(row.get("direction") or "INGRESO"),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            log.warning("Cámara inválida omitida: %s (%s)", row, exc)
    return out


def grab_frame(cam: CameraCfg) -> Optional[np.ndarray]:
    if cam.snapshot_url:
        try:
            r = requests.get(cam.snapshot_url, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            arr = np.frombuffer(r.content, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is not None:
                return frame
            log.warning("[%s] snapshot HTTP no decodificable", cam.name)
        except Exception as exc:  # noqa: BLE001
            log.warning("[%s] error snapshot: %s", cam.name, exc)

    if cam.stream_url:
        cap = cv2.VideoCapture(cam.stream_url)
        try:
            # Descartar frames en buffer
            for _ in range(3):
                cap.read()
            ok, frame = cap.read()
            if ok and frame is not None:
                return frame
            log.warning("[%s] no se pudo leer frame RTSP", cam.name)
        finally:
            cap.release()
    return None


def encode_jpeg_b64(frame: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode("ascii")


def pick_best_plate(ocr_result: Any) -> Optional[Tuple[str, float, str]]:
    """
    RapidOCR devuelve (boxes_texts_scores, elapsed) o None.
    Retorna (plate_norm, confidence, raw_text).
    """
    if not ocr_result:
        return None
    lines = ocr_result[0] if isinstance(ocr_result, (list, tuple)) else None
    if not lines:
        return None

    best: Optional[Tuple[str, float, str]] = None
    for item in lines:
        try:
            text = str(item[1])
            score = float(item[2])
        except (IndexError, TypeError, ValueError):
            continue
        norm = normalize_plate(text)
        if not norm or not PLATE_CANDIDATE_RE.match(norm):
            continue
        # Priorizar patrones de placa PE
        bonus = 0.08 if PLATE_STRICT_RE.match(norm) else 0.0
        ranked = min(0.99, score + bonus)
        if best is None or ranked > best[1]:
            best = (norm, ranked, text)
    return best


def post_detection(
    cam: CameraCfg,
    plate: str,
    confidence: float,
    raw_ocr: str,
    frame: np.ndarray,
) -> None:
    body = {
        "camera_id": cam.camera_id,
        "license_plate": plate,
        "confidence": round(float(confidence), 4),
        "raw_ocr": raw_ocr,
        "snapshot_base64": encode_jpeg_b64(frame),
    }
    url = f"{API_BASE}/lpr/events"
    r = requests.post(url, headers=api_headers(), json=body, timeout=REQUEST_TIMEOUT)
    if r.status_code >= 400:
        log.error("[%s] API %s: %s", cam.name, r.status_code, r.text[:300])
        return
    try:
        data = r.json().get("data") or {}
    except Exception:  # noqa: BLE001
        data = {}
    log.info(
        "[%s] placa=%s conf=%.2f result=%s",
        cam.name,
        plate,
        confidence,
        data.get("result"),
    )


def main() -> None:
    if not SERVICE_TOKEN:
        log.error("LPR_SERVICE_TOKEN vacío; el worker no puede autenticarse")
        raise SystemExit(1)

    log.info("Iniciando LPR worker → %s", API_BASE)
    engine = RapidOCR()

    cameras: List[CameraCfg] = []
    last_refresh = 0.0
    last_poll: Dict[int, float] = {}
    last_sent: Dict[Tuple[int, str], float] = {}

    while True:
        now = time.time()
        if now - last_refresh >= REFRESH_CAMERAS_SEC or not cameras:
            try:
                cameras = fetch_cameras()
                last_refresh = now
                log.info("Cámaras activas: %d", len(cameras))
            except Exception as exc:  # noqa: BLE001
                log.error("No se pudieron cargar cámaras: %s", exc)
                time.sleep(5)
                continue

        if not cameras:
            time.sleep(5)
            continue

        for cam in cameras:
            interval = max(0.2, (cam.poll_interval_ms or DEFAULT_POLL_MS) / 1000.0)
            last = last_poll.get(cam.camera_id, 0.0)
            if now - last < interval:
                continue
            last_poll[cam.camera_id] = now

            frame = grab_frame(cam)
            if frame is None:
                continue

            try:
                result = engine(frame)
            except Exception as exc:  # noqa: BLE001
                log.warning("[%s] OCR falló: %s", cam.name, exc)
                continue

            picked = pick_best_plate(result)
            if not picked:
                continue
            plate, conf, raw = picked
            if conf < cam.min_confidence:
                log.debug("[%s] baja confianza local %.2f <%s>", cam.name, conf, cam.min_confidence)
                continue

            key = (cam.camera_id, plate)
            debounce = max(5, cam.debounce_seconds)
            prev = last_sent.get(key, 0.0)
            if now - prev < debounce:
                continue

            try:
                post_detection(cam, plate, conf, raw, frame)
                last_sent[key] = now
            except Exception as exc:  # noqa: BLE001
                log.error("[%s] error enviando detección: %s", cam.name, exc)

        time.sleep(0.05)


if __name__ == "__main__":
    main()
