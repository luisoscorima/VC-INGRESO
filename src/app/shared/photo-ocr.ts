import { parsePeruvianLicensePlate } from './license-plate';
import { inferIdentityDocumentType, normalizeIdentityDocument } from './identity-document';

export type PhotoOcrStatus = 'pending' | 'done' | 'empty' | 'error';

export interface PhotoOcrExtractResult {
  photo_doc_number: string | null;
  photo_license_plate: string | null;
  photo_first_names: string | null;
  photo_last_names: string | null;
  photo_ocr_status: PhotoOcrStatus;
  rawText?: string;
}

export interface PhotoOcrIdentity {
  doc: string | null;
  plate: string | null;
  firstNames: string | null;
  lastNames: string | null;
}

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;

async function getOcrWorker(): Promise<import('tesseract.js').Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      // Sin whitelist agresiva: hace falta leer nombres (acentos) y etiquetas.
      const worker = await createWorker('spa+eng');
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });
      return worker;
    })();
  }
  return workerPromise;
}

/** @deprecated Usar extractIdentityFromOcrText */
export function extractDocAndPlateFromOcrText(raw: string): {
  doc: string | null;
  plate: string | null;
} {
  const id = extractIdentityFromOcrText(raw);
  return { doc: id.doc, plate: id.plate };
}

/** Extrae DNI, placa, nombres y apellidos de texto OCR (DNI, licencia, carnets, etc.). */
export function extractIdentityFromOcrText(raw: string): PhotoOcrIdentity {
  const text = String(raw ?? '').toUpperCase();
  const names = pickNames(text);
  return {
    doc: pickBestDni(text),
    plate: pickBestPlate(text),
    firstNames: names.firstNames,
    lastNames: names.lastNames,
  };
}

function pickBestDni(text: string): string | null {
  const scored = new Map<string, number>();

  const bump = (candidate: string, score: number) => {
    if (!/^\d{8}$/.test(candidate)) {
      return;
    }
    // Basura tipo 00000000 / 30000700 (muchos ceros)
    const zeroCount = (candidate.match(/0/g) || []).length;
    if (zeroCount >= 5 || /^(\d)\1{7}$/.test(candidate)) {
      return;
    }
    if (inferIdentityDocumentType(candidate) !== 'DNI') {
      return;
    }
    const normalized = normalizeIdentityDocument('DNI', candidate);
    scored.set(normalized, Math.max(scored.get(normalized) ?? 0, score));
  };

  // MRZ
  for (const m of text.matchAll(/(?:I\s*<\s*)?PER\s*([0-9O\s]{8,12})/g)) {
    const d = ocrDigits(m[1]);
    if (d.length >= 8) {
      bump(d.slice(0, 8), 50);
    }
  }

  // Etiquetas explícitas (DNI Reniec, carnets, credenciales, licencias).
  for (const m of text.matchAll(
    /(?:DOCUMENTO\s*DE\s*IDENTIDAD|NRO\.?\s*DE\s*LICENCIA|N[°º]?\s*DE\s*LICENCIA|DNI|CUI|IDENTIDAD)\s*[.:]?\s*Q?\s*([0-9O]{8})(?:\s*[-–]?\s*[0-9O])?/g
  )) {
    bump(ocrDigits(m[1]), 45);
  }

  // Licencia Q10412162 suelta
  for (const m of text.matchAll(/\bQ\s*([0-9O]{8})\b/g)) {
    bump(ocrDigits(m[1]), 42);
  }

  // CUI + verificador (9 dígitos)
  for (const m of text.matchAll(/\b([0-9O]{9})\b/g)) {
    const nine = ocrDigits(m[1]);
    if (nine.length === 9) {
      bump(nine.slice(0, 8), 30);
    }
  }

  for (const m of text.matchAll(/\b([0-9O]{8})\s*[-–]\s*[0-9O]\b/g)) {
    bump(ocrDigits(m[1]), 35);
  }

  for (const m of text.matchAll(/\b([0-9O]{8})\b/g)) {
    const eight = ocrDigits(m[1]);
    let score = 18;
    if (looksLikeDateDdmmyyyy(eight) || looksLikeDateYyyymmdd(eight)) {
      score -= 25;
    }
    if (eight.startsWith('0')) {
      score -= 8;
    }
    bump(eight, score);
  }

  const digitsOnly = ocrDigits(text);
  for (let i = 0; i <= digitsOnly.length - 8; i++) {
    const slice = digitsOnly.slice(i, i + 8);
    let score = 5;
    if (looksLikeDateDdmmyyyy(slice) || looksLikeDateYyyymmdd(slice)) {
      score -= 20;
    }
    if (slice.startsWith('0')) {
      score -= 8;
    }
    bump(slice, score);
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [doc, score] of scored) {
    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }
  return bestScore >= 15 ? best : null;
}

function pickNames(text: string): { firstNames: string | null; lastNames: string | null } {
  let firstNames: string | null = null;
  let lastNames: string | null = null;

  // MRZ línea de nombres: APELLIDO<<NOMBRE1<NOMBRE2
  const mrzName = text.match(
    /(?:^|[^A-Z])([A-ZÁÉÍÓÚÑ]{2,}(?:<[A-ZÁÉÍÓÚÑ]+)*)<<([A-ZÁÉÍÓÚÑ]+(?:<[A-ZÁÉÍÓÚÑ]+)*)/
  );
  if (mrzName) {
    lastNames = cleanName(mrzName[1].replace(/</g, ' '));
    firstNames = cleanName(mrzName[2].replace(/</g, ' '));
    if (lastNames && firstNames) {
      return { firstNames, lastNames };
    }
  }

  const labeledLast = matchLabeledName(text, [
    'APELLIDOS',
    'APELLIDO',
    'PRIMER APELLIDO',
    'SEGUNDO APELLIDO',
  ]);
  const labeledFirst = matchLabeledName(text, [
    'PRENOMBRES',
    'PRE NOMBRES',
    'NOMBRES',
    'NOMBRE',
  ]);

  if (labeledLast) {
    lastNames = labeledLast;
  }
  if (labeledFirst) {
    firstNames = labeledFirst;
  }

  // Carné municipal / layout suelto: 1–2 líneas de nombre encima del DNI.
  if (!firstNames || !lastNames) {
    const near = namesNearDoc(text);
    if (!lastNames && near.lastNames) {
      lastNames = near.lastNames;
    }
    if (!firstNames && near.firstNames) {
      firstNames = near.firstNames;
    }
  }

  return { firstNames, lastNames };
}

function matchLabeledName(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const esc = label.replace(/\s+/g, '\\s+');
    const re = new RegExp(
      esc + '\\s*[.:]?\\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\\s]{1,50}?)(?=\\n|DOCUMENTO|DNI|NRO|FECHA|SEXO|CARGO|CLASE|CATEG|$)',
      'i'
    );
    const m = text.match(re);
    if (m?.[1]) {
      const cleaned = cleanName(m[1]);
      if (cleaned && cleaned.length >= 2) {
        return cleaned;
      }
    }
  }
  return null;
}

/** Heurística: líneas alfabéticas justo antes de un DNI de 8 dígitos. */
function namesNearDoc(text: string): { firstNames: string | null; lastNames: string | null } {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const dig = ocrDigits(lines[i]);
    if (!/^\d{8}$/.test(dig) && !/^\d{9}$/.test(dig)) {
      continue;
    }
    const above: string[] = [];
    for (let j = i - 1; j >= 0 && above.length < 3; j--) {
      const cand = cleanName(lines[j]);
      if (!cand) {
        continue;
      }
      if (/SUBGERENCIA|TRANSPORTE|CARNÉ|CARNE|EDUCACI|SEGURIDAD|VIAL|PABLO|MENDOZA|REPUBLICA|LICENCIA|MINISTERIO|DOCUMENTO|IDENTIDAD|FECHA|NACIMIENTO|ESTADO|SEXO|UBIGEO|CADUCIDAD|EMISI[OÓ]N|FECNA|CADUC/.test(cand)) {
        continue;
      }
      if (cand.split(/\s+/).length > 5) {
        continue;
      }
      if (cand.length < 2 || cand.length > 40) {
        continue;
      }
      above.unshift(cand);
    }
    if (above.length === 1) {
      // Solo un renglón: tratar como nombre completo → último token apellido débil; mejor last=todo si 2+ palabras
      const parts = above[0].split(/\s+/);
      if (parts.length >= 2) {
        return {
          firstNames: parts.slice(0, -1).join(' '),
          lastNames: parts[parts.length - 1],
        };
      }
      return { firstNames: above[0], lastNames: null };
    }
    if (above.length >= 2) {
      // Convención carné vial: NOMBRE(s) luego APELLIDOS
      return {
        firstNames: above[0],
        lastNames: above.slice(1).join(' '),
      };
    }
  }
  return { firstNames: null, lastNames: null };
}

function cleanName(raw: string): string | null {
  let t = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑÜ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^(NOMBRES?|APELLIDOS?|PRENOMBRES?)\s+/i, '').trim();
  t = t
    .replace(/\b(DOCUMENTO|IDENTIDAD|DNI|FECHA|NACIMIENTO|ESTADO|CIVIL|SEXO|CARGO|CLASE|CATEGORIA|LICENCIA|UBIGEO|CADUCIDAD|EMISION|DOCU|DENTIDAD)\b.*$/i, '')
    .trim();
  // Quitar restos tipo "DOCU IE AE"
  t = t.replace(/\b(DOCU|IE|AE|IND|TF|ON)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 2) {
    return null;
  }
  if (!/[A-ZÁÉÍÓÚÑ]{2,}/i.test(t)) {
    return null;
  }
  // Quitar tokens basura de 1 letra al final (p. ej. "WI", "ÍA" sueltos de OCR)
  const parts = t.split(/\s+/).filter((p) => p.length >= 2);
  if (!parts.length) {
    return null;
  }
  // Ruido final de 2 letras tras un nombre completo (p. ej. "… RAMIREZ WI")
  if (parts.length >= 3 && parts[parts.length - 1].length <= 2) {
    parts.pop();
  }
  return parts.join(' ').slice(0, 80);
}

function pickBestPlate(text: string): string | null {
  // Fotos de carné/DNI/licencia: no inventar placa salvo que diga PLACA.
  const isIdLikeDoc = /DNI|IDENTIDAD|LICENCIA|CARN[EÉ]|NOMBRE|APELLIDO|REPUBLICA|RENIEC|DOCUMENTO|PER<{2,}|(?:I<)?PER\d{8}/.test(
    text
  );
  if (isIdLikeDoc && !/\bPLACA\b/.test(text)) {
    return null;
  }

  const dense = text.replace(/[^A-Z0-9]/g, '');
  let bestPlate: string | null = null;
  let bestScore = 0;
  const doc = pickBestDni(text);

  for (let i = 0; i <= dense.length - 6; i++) {
    const slice = dense.slice(i, i + 6);
    if (!/[A-Z]/.test(slice) || !/[0-9]/.test(slice)) {
      continue;
    }
    if (/^(DNI|CE|PER|PLACA|NOMBRE|CARGO|FECHA)/.test(slice)) {
      continue;
    }
    const parsed = parsePeruvianLicensePlate(slice);
    if (!parsed.valid) {
      continue;
    }
    if (doc && parsed.canonical.includes(doc.slice(0, 4))) {
      continue;
    }
    const score = scorePlateCandidate(parsed.canonical);
    if (score > bestScore) {
      bestScore = score;
      bestPlate = parsed.canonical;
    }
  }

  for (const m of text.matchAll(/\b([A-Z0-9]{1,3})[-\s]?([A-Z0-9]{3,5})\b/g)) {
    const compact = (m[1] + m[2]).replace(/[^A-Z0-9]/g, '');
    if (compact.length !== 6) {
      continue;
    }
    const parsed = parsePeruvianLicensePlate(compact);
    if (!parsed.valid) {
      continue;
    }
    if (doc && parsed.canonical.includes(doc.slice(0, 4))) {
      continue;
    }
    const score = scorePlateCandidate(parsed.canonical) + 2;
    if (score > bestScore) {
      bestScore = score;
      bestPlate = parsed.canonical;
    }
  }

  return bestScore >= 2 ? bestPlate : null;
}

function ocrDigits(raw: string): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/\D+/g, '');
}

function looksLikeDateDdmmyyyy(eight: string): boolean {
  const dd = Number(eight.slice(0, 2));
  const mm = Number(eight.slice(2, 4));
  const yyyy = Number(eight.slice(4, 8));
  return dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 1920 && yyyy <= 2100;
}

function looksLikeDateYyyymmdd(eight: string): boolean {
  const yyyy = Number(eight.slice(0, 4));
  const mm = Number(eight.slice(4, 6));
  const dd = Number(eight.slice(6, 8));
  return yyyy >= 1920 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

function scorePlateCandidate(canonical: string): number {
  if (/^[A-Z]{3}[0-9]{3}$/.test(canonical)) {
    return 4;
  }
  if (/^[A-Z][0-9][0-9]{4}$/.test(canonical)) {
    return 4;
  }
  if (/^[0-9]{3}[A-Z]{3}$/.test(canonical)) {
    return 3;
  }
  if (/^[A-Z]{2}[0-9]{4}$/.test(canonical) || /^[0-9]{4}[A-Z]{2}$/.test(canonical)) {
    return 3;
  }
  if (/^[A-Z]+[0-9]+$/.test(canonical) || /^[0-9]+[A-Z]+$/.test(canonical)) {
    return 1;
  }
  return 0;
}

async function recognizeOne(source: File | Blob | string): Promise<string> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(source);
  return String(data?.text ?? '');
}

export async function extractDocAndPlateFromPhotos(
  sources: Array<File | Blob | string>
): Promise<PhotoOcrExtractResult> {
  if (!sources.length) {
    return emptyResult('empty');
  }

  let doc: string | null = null;
  let plate: string | null = null;
  let firstNames: string | null = null;
  let lastNames: string | null = null;
  const texts: string[] = [];

  try {
    for (const src of sources) {
      const text = await recognizeOne(src);
      texts.push(text);
      const found = extractIdentityFromOcrText(text);
      if (!doc && found.doc) {
        doc = found.doc;
      }
      if (!plate && found.plate) {
        plate = found.plate;
      }
      if (!firstNames && found.firstNames) {
        firstNames = found.firstNames;
      }
      if (!lastNames && found.lastNames) {
        lastNames = found.lastNames;
      }
    }
  } catch (err) {
    console.warn('[photo-ocr] recognize failed', err);
    const hasAny = !!(doc || plate || firstNames || lastNames);
    return {
      photo_doc_number: doc,
      photo_license_plate: plate,
      photo_first_names: firstNames,
      photo_last_names: lastNames,
      photo_ocr_status: hasAny ? 'done' : 'error',
      rawText: texts.join('\n'),
    };
  }

  const hasAny = !!(doc || plate || firstNames || lastNames);
  return {
    photo_doc_number: doc,
    photo_license_plate: plate,
    photo_first_names: firstNames,
    photo_last_names: lastNames,
    photo_ocr_status: hasAny ? 'done' : 'empty',
    rawText: texts.join('\n'),
  };
}

function emptyResult(status: PhotoOcrStatus): PhotoOcrExtractResult {
  return {
    photo_doc_number: null,
    photo_license_plate: null,
    photo_first_names: null,
    photo_last_names: null,
    photo_ocr_status: status,
  };
}

export function schedulePhotoOcr(
  sources: Array<File | Blob | string>,
  run: (result: PhotoOcrExtractResult) => void
): void {
  const start = () => {
    void extractDocAndPlateFromPhotos(sources)
      .then(run)
      .catch((err) => {
        console.warn('[photo-ocr] schedule failed', err);
        run(emptyResult('error'));
      });
  };

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => start(), { timeout: 4000 });
  } else {
    setTimeout(start, 500);
  }
}
