import logging
import os
import re
import signal
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import cv2
import easyocr
import requests


PLATE_PATTERN = re.compile(r"^[A-Z0-9]{5,8}$")


@dataclass(frozen=True)
class Config:
    api_base: str
    camera_api_key: str
    camera_source: str
    confidence_threshold: float
    capture_interval_seconds: float
    local_debounce_seconds: int
    stable_reads: int
    roi: Optional[tuple[float, float, float, float]]
    verify_tls: bool

    @classmethod
    def from_env(cls) -> "Config":
        api_base = os.getenv("API_BASE", "https://villa-club5.com").rstrip("/")
        camera_api_key = os.getenv("CAMERA_API_KEY", "").strip()
        camera_source = os.getenv("CAMERA_SOURCE", "0").strip()
        if not camera_api_key:
            raise RuntimeError("CAMERA_API_KEY es obligatorio")
        return cls(
            api_base=api_base,
            camera_api_key=camera_api_key,
            camera_source=camera_source,
            confidence_threshold=float(os.getenv("OCR_CONFIDENCE_THRESHOLD", "0.55")),
            capture_interval_seconds=max(0.2, float(os.getenv("CAPTURE_INTERVAL_SECONDS", "1.0"))),
            local_debounce_seconds=max(1, int(os.getenv("LOCAL_DEBOUNCE_SECONDS", "45"))),
            stable_reads=max(1, int(os.getenv("STABLE_READS", "2"))),
            roi=parse_roi(os.getenv("CAMERA_ROI", "")),
            verify_tls=os.getenv("VERIFY_TLS", "true").lower() not in {"0", "false", "no"},
        )


def parse_roi(value: str) -> Optional[tuple[float, float, float, float]]:
    if not value.strip():
        return None
    parts = [float(part.strip()) for part in value.split(",")]
    if len(parts) != 4 or any(part < 0 or part > 1 for part in parts):
        raise RuntimeError("CAMERA_ROI debe ser x1,y1,x2,y2 con valores entre 0 y 1")
    x1, y1, x2, y2 = parts
    if x2 <= x1 or y2 <= y1:
        raise RuntimeError("CAMERA_ROI debe definir un rectángulo válido")
    return x1, y1, x2, y2


def normalize_plate(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def crop_roi(frame, roi: Optional[tuple[float, float, float, float]]):
    if roi is None:
        return frame
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = roi
    return frame[int(y1 * height) : int(y2 * height), int(x1 * width) : int(x2 * width)]


class LprWorker:
    def __init__(self, config: Config):
        self.config = config
        self.reader = easyocr.Reader(["en"], gpu=os.getenv("EASYOCR_GPU", "false").lower() == "true")
        self.session = requests.Session()
        self.recent: dict[str, float] = {}
        self.candidates: deque[str] = deque(maxlen=config.stable_reads)
        self.running = True

    def stop(self, *_args) -> None:
        self.running = False

    def run(self) -> None:
        while self.running:
            capture = self.open_capture()
            if capture is None:
                time.sleep(5)
                continue
            try:
                self.read_loop(capture)
            finally:
                capture.release()
            if self.running:
                logging.warning("Stream desconectado; reintentando en 3 segundos")
                time.sleep(3)

    def open_capture(self):
        source = int(self.config.camera_source) if self.config.camera_source.isdigit() else self.config.camera_source
        capture = cv2.VideoCapture(source)
        if not capture.isOpened():
            logging.error("No se pudo abrir CAMERA_SOURCE")
            capture.release()
            return None
        logging.info("Stream de cámara conectado")
        return capture

    def read_loop(self, capture) -> None:
        next_capture_at = 0.0
        while self.running:
            ok, frame = capture.read()
            if not ok:
                return
            now = time.monotonic()
            if now < next_capture_at:
                continue
            next_capture_at = now + self.config.capture_interval_seconds

            plate, confidence = self.detect_plate(crop_roi(frame, self.config.roi))
            if not plate:
                self.candidates.clear()
                continue

            self.candidates.append(plate)
            if len(self.candidates) < self.config.stable_reads or len(set(self.candidates)) != 1:
                continue
            if now - self.recent.get(plate, 0.0) < self.config.local_debounce_seconds:
                continue

            if self.send_reading(plate, confidence, frame):
                self.recent[plate] = now
                self.candidates.clear()
                self.prune_recent(now)

    def detect_plate(self, image) -> tuple[Optional[str], float]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.bilateralFilter(gray, 9, 75, 75)
        detections = self.reader.readtext(
            gray,
            detail=1,
            paragraph=False,
            allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
        )
        best_plate = None
        best_confidence = 0.0
        for _box, text, confidence in detections:
            plate = normalize_plate(text)
            score = float(confidence)
            if (
                score >= self.config.confidence_threshold
                and PLATE_PATTERN.fullmatch(plate)
                and score > best_confidence
            ):
                best_plate = plate
                best_confidence = score
        return best_plate, best_confidence

    def send_reading(self, plate: str, confidence: float, frame) -> bool:
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
        if not ok:
            logging.error("No se pudo codificar la captura")
            return False

        url = f"{self.config.api_base}/api/v1/camera-access/ingest"
        data = {
            "license_plate": plate,
            "confidence": f"{confidence:.4f}",
            "captured_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        }
        files = {"photo": (f"{plate}.jpg", encoded.tobytes(), "image/jpeg")}
        try:
            response = self.session.post(
                url,
                headers={"X-Camera-Key": self.config.camera_api_key},
                data=data,
                files=files,
                timeout=(5, 20),
                verify=self.config.verify_tls,
            )
            response.raise_for_status()
            payload = response.json()
            logging.info(
                "Lectura enviada placa=%s resultado=%s tipo=%s",
                plate,
                payload.get("data", {}).get("result", "UNKNOWN"),
                payload.get("data", {}).get("match_type", "UNKNOWN"),
            )
            return True
        except (requests.RequestException, ValueError) as exc:
            logging.error("Error enviando lectura de %s: %s", plate, exc)
            return False

    def prune_recent(self, now: float) -> None:
        expiry = self.config.local_debounce_seconds * 4
        self.recent = {plate: sent_at for plate, sent_at in self.recent.items() if now - sent_at < expiry}


def main() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    worker = LprWorker(Config.from_env())
    signal.signal(signal.SIGINT, worker.stop)
    signal.signal(signal.SIGTERM, worker.stop)
    worker.run()


if __name__ == "__main__":
    main()
