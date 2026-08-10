# AWS S3 – setup VC-Ingreso

Bucket compartido `crearttech-storage`, prefijo `vc-ingreso/`.  
Media público (solo lectura) por ahora; backups de BD privados.  
Paths en BD siguen siendo lógicos (`/uploads/...`); el archivo vive solo en S3.

## Estructura

```text
crearttech-storage/
  vc-ingreso/
    media/
      incidents|vehicles|pets|profiles|camera-access|announcements|readonly-docs/
    backups/
      db/
```

## 1. Crear bucket (consola)

- Región: `us-east-1`
- Tipo: Uso general
- Nombre: `crearttech-storage`
- ACL deshabilitadas
- Block Public Access: permitir bucket policies públicas (desmarcar bloqueo de políticas)
- Cifrado: SSE-S3
- Versiones / Object Lock: off

Detalle paso a paso: ver historial del chat o consola AWS.

## 2. Bucket policy (media público)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadMediaOnly",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::crearttech-storage/vc-ingreso/media/*"
    }
  ]
}
```

## 3. CORS

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": [
      "https://villa-club5.com",
      "http://localhost:4200"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## 4. Usuario IAM `vc-ingreso-s3`

Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListPrefix",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::crearttech-storage",
      "Condition": {
        "StringLike": { "s3:prefix": ["vc-ingreso/*"] }
      }
    },
    {
      "Sid": "RWAppObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::crearttech-storage/vc-ingreso/media/*",
        "arn:aws:s3:::crearttech-storage/vc-ingreso/backups/*"
      ]
    }
  ]
}
```

Access key solo en `.env` del servidor.

## 5. Variables de entorno

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=crearttech-storage
S3_KEY_PREFIX=vc-ingreso
S3_MEDIA_PUBLIC_BASE_URL=https://crearttech-storage.s3.us-east-1.amazonaws.com/vc-ingreso/media
```

## 6. Migración one-shot (ya hecha en prod)

```bash
./scripts/migrate-uploads-to-s3.sh --dry-run
./scripts/migrate-uploads-to-s3.sh
```

## 7. Comprimir históricos en S3

```bash
./scripts/compress-s3-media.sh --limit 10
./scripts/compress-s3-media.sh --folder=all --all --apply
```

(`scripts/compress-incident-photos.sh` es legacy del volumen local; redirige a este.)

## 8. Eliminar volumen local de uploads (liberar disco)

Cuando el compose ya no monte `uploads_data` y hayas validado media en S3:

```bash
# Ver si el volumen aún existe y cuánto ocupa
docker volume ls | grep uploads
docker run --rm -v vc-ingreso_uploads_data:/data alpine du -sh /data

# Tras redeploy sin el mount, borrar el volumen huérfano
docker volume rm vc-ingreso_uploads_data

# Si Compose se queja porque el volumen sigue declarado en un stack viejo:
docker compose -f docker-compose.prod.yml down
docker volume rm vc-ingreso_uploads_data
docker compose -f docker-compose.prod.yml up -d
```

No borra nada en S3 ni en la BD.

## 9. Privado en el futuro

1. Quitar `PublicReadMediaOnly` de la bucket policy.
2. `STORAGE_MEDIA_VISIBILITY=private` + URLs firmadas / proxy auth.
