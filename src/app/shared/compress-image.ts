import { from, Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';

/**
 * Reduce tamaño de imagen para subidas móviles (canvas → JPEG).
 * Si falla o el resultado no mejora, devuelve el archivo original.
 */
export async function compressImageFile(
  file: File,
  options?: { maxEdge?: number; quality?: number }
): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  const maxEdge = options?.maxEdge ?? 1280;
  const quality = options?.quality ?? 0.72;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });

    if (!blob || blob.size === 0) {
      return file;
    }
    // Si no reduce (p. ej. JPEG pequeño ya optimizado), conservar original
    if (blob.size >= file.size && (file.type === 'image/jpeg' || file.type === 'image/jpg')) {
      return file;
    }

    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}

/** Observable helper: comprime y luego ejecuta el upload. */
export function compressThenUpload<T>(
  file: File,
  upload: (compressed: File) => Observable<T>,
  options?: { maxEdge?: number; quality?: number }
): Observable<T> {
  return from(compressImageFile(file, options)).pipe(switchMap((compressed) => upload(compressed)));
}
