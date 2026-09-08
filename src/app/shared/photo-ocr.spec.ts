import { extractDocAndPlateFromOcrText, extractIdentityFromOcrText } from './photo-ocr';

describe('extractDocAndPlateFromOcrText', () => {
  it('detecta DNI de 8 dígitos', () => {
    const r = extractDocAndPlateFromOcrText('REPUBLICA DEL PERU DNI 45678912');
    expect(r.doc).toBe('45678912');
  });

  it('detecta placa peruana de 6 caracteres', () => {
    const r = extractDocAndPlateFromOcrText('PLACA ABC-123');
    expect(r.plate).toBe('ABC123');
  });

  it('detecta ambos en el mismo texto', () => {
    const r = extractDocAndPlateFromOcrText('DNI 12345678 PLACA XYZ987');
    expect(r.doc).toBe('12345678');
    expect(r.plate).toBe('XYZ987');
  });

  it('prioriza CUI con dígito verificador (fotos reales)', () => {
    const r = extractDocAndPlateFromOcrText(
      'DOCUMENTO NACIONAL DE IDENTIDAD 774423589\nROSAS OBREGON\n0209301171'
    );
    expect(r.doc).toBe('77442358');
  });

  it('no confunde fecha de nacimiento con DNI', () => {
    const r = extractDocAndPlateFromOcrText(
      'ROGER FREDY\n27 10 1980 021602\n40967604 <<<<<<<<\n8010270M2909163PER<<<<<<<<<'
    );
    expect(r.doc).toBe('40967604');
  });

  it('lee DNI desde MRZ PER', () => {
    const r = extractDocAndPlateFromOcrText('I<PER47293074<4<<<<<<<<<<<<<<<');
    expect(r.doc).toBe('47293074');
  });

  it('lee placa mototaxi C2-9870', () => {
    const r = extractDocAndPlateFromOcrText('C2-9870');
    expect(r.plate).toBe('C29870');
  });
});

describe('extractIdentityFromOcrText', () => {
  it('lee carné municipal NOMBRE/APELLIDOS/DNI', () => {
    const r = extractIdentityFromOcrText(
      'CARNÉ DE EDUCACIÓN Y SEGURIDAD VIAL\nNOMBRE: DARWIN\nAPELLIDOS: MARQUEZ BERECHE\nDOCUMENTO DE IDENTIDAD: 42841382'
    );
    expect(r.doc).toBe('42841382');
    expect(r.firstNames).toContain('DARWIN');
    expect(r.lastNames).toContain('MARQUEZ');
  });

  it('lee credencial empresa Nombre/DNI', () => {
    const r = extractIdentityFromOcrText(
      'Nombre: Eugenio Antonio Ramirez\nDNI:41718587\nCargo: Chofer de Reparto'
    );
    expect(r.doc).toBe('41718587');
    expect(r.firstNames).toContain('EUGENIO');
  });

  it('lee nombres desde MRZ', () => {
    const r = extractIdentityFromOcrText(
      'I<PER43110543<7<<<<<<<<<<<<<<<\nLUNAZCO<<JORGE<LUIS<<<<<<<<<<<'
    );
    expect(r.doc).toBe('43110543');
    expect(r.lastNames).toContain('LUNAZCO');
    expect(r.firstNames).toContain('JORGE');
  });

  it('lee licencia Q + 8 dígitos', () => {
    const r = extractIdentityFromOcrText('Nro de Licencia: Q40096503\nApellidos: ARANGO PAREJA\nNombres: WALTER OMAR');
    expect(r.doc).toBe('40096503');
    expect(r.lastNames).toContain('ARANGO');
    expect(r.firstNames).toContain('WALTER');
  });

  it('heurística carné sin etiquetas claras', () => {
    const r = extractIdentityFromOcrText(
      'CARNÉ DE EDUCACIÓN Y SEGURIDAD VIAL\nMAURO MAXIMILIANO\nMARTINEZ OBREGON\n40438696\nPABLO MENDOZA'
    );
    expect(r.doc).toBe('40438696');
    expect(r.firstNames).toContain('MAURO');
    expect(r.lastNames).toContain('MARTINEZ');
  });
});
