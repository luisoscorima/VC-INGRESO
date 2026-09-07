/** Frases fijas iniciales para chips de Nota en garita. */
export const OPERATOR_NOTE_SEED_PHRASES = [
  'Taxi',
  'Colectivo',
  'Mototaxi',
  'Motorizado',
  'Delivery',
  'Visita',
  'Proveedor',
  'Mudanza',
] as const;

const STORAGE_KEY = 'vc.operator_notes.phrases';
const MAX_PHRASE_LEN = 120;
const DEFAULT_LIMIT = 8;

type PhraseCounts = Record<string, number>;

function loadCounts(): PhraseCounts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: PhraseCounts = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0) {
        out[k] = Math.floor(n);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveCounts(counts: PhraseCounts): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // quota / private mode: ignore
  }
}

/** Trim, colapsa espacios; descarta vacías o demasiado largas para ranking. */
export function normalizeOperatorNotePhrase(raw: string | null | undefined): string | null {
  const t = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!t || t.length > MAX_PHRASE_LEN) {
    return null;
  }
  return canonicalizePhrase(t);
}

/** Si coincide con una semilla (sin importar mayúsculas), usa la forma canónica. */
function canonicalizePhrase(phrase: string): string {
  const lower = phrase.toLowerCase();
  const seed = OPERATOR_NOTE_SEED_PHRASES.find((s) => s.toLowerCase() === lower);
  return seed ?? phrase;
}

/**
 * Top de frases: semillas siempre candidatas + frases aprendidas.
 * Orden por frecuencia; empates respetan el orden de semillas.
 */
export function getTopOperatorNotePhrases(limit = DEFAULT_LIMIT): string[] {
  const counts = loadCounts();
  const candidates = new Map<string, number>();

  for (const seed of OPERATOR_NOTE_SEED_PHRASES) {
    candidates.set(seed, counts[seed] || 0);
  }
  for (const [phrase, n] of Object.entries(counts)) {
    if (!candidates.has(phrase) && n > 0) {
      candidates.set(phrase, n);
    }
  }

  return [...candidates.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      const ai = (OPERATOR_NOTE_SEED_PHRASES as readonly string[]).indexOf(a[0]);
      const bi = (OPERATOR_NOTE_SEED_PHRASES as readonly string[]).indexOf(b[0]);
      if (ai >= 0 && bi >= 0) {
        return ai - bi;
      }
      if (ai >= 0) {
        return -1;
      }
      if (bi >= 0) {
        return 1;
      }
      return a[0].localeCompare(b[0], 'es');
    })
    .slice(0, Math.max(1, limit))
    .map(([p]) => p);
}

/** Incrementa frecuencia de una nota guardada (frase completa). */
export function recordOperatorNotePhrase(note: string | null | undefined): void {
  const phrase = normalizeOperatorNotePhrase(note);
  if (!phrase) {
    return;
  }
  const counts = loadCounts();
  counts[phrase] = (counts[phrase] || 0) + 1;
  saveCounts(counts);
}

/**
 * Tap en chip: si el campo está vacío → frase; si ya hay texto → no pisa.
 */
export function applyOperatorNoteChip(current: string | null | undefined, phrase: string): string {
  if (String(current ?? '').trim()) {
    return String(current ?? '');
  }
  return phrase;
}
