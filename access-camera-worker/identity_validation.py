import re

PLATE_PATTERN = re.compile(r"^[A-Z0-9]{6}$")


def normalize_plate(text: str) -> str:
    normalized = text.strip().upper()
    if not re.fullmatch(r"[A-Z0-9 -]+", normalized):
        return ""
    return re.sub(r"[ -]+", "", normalized)


def is_valid_plate(text: str) -> bool:
    return PLATE_PATTERN.fullmatch(normalize_plate(text)) is not None


def normalize_document(document_type: str, value: str) -> str:
    normalized = value.strip()
    return normalized.upper() if document_type.upper() == "CE" else normalized


def is_valid_document(document_type: str, value: str) -> bool:
    document_type = document_type.strip().upper()
    normalized = normalize_document(document_type, value)
    if document_type == "DNI":
        return re.fullmatch(r"[0-9]{8}", normalized) is not None
    if document_type == "CE":
        return re.fullmatch(r"[A-Z0-9]{7,15}", normalized) is not None
    return False
