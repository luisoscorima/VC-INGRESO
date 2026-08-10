# AWS S3 – setup VC-Ingreso

Bucket compartido `crearttech-storage`, prefijo `vc-ingreso/`.  
Media público (solo lectura) por ahora; backups privados. Paths en BD siguen siendo relativos (`/uploads/...`).

## Estructura

```text
crearttech-storage/
  vc-ingreso/
    media/
      incidents|vehicles|pets|profiles|camera-access|announcements|readonly-docs/
    backups/
      db/
      uploads/
```

## 1. Crear bucket

```bash
aws s3api create-bucket \
  --bucket crearttech-storage \
  --region us-east-1
```

Si la región no es `us-east-1`:

```bash
aws s3api create-bucket \
  --bucket crearttech-storage \
  --region <REGION> \
  --create-bucket-configuration LocationConstraint=<REGION>
```

Recomendado:

- Cifrado SSE-S3 (default).
- Versionado opcional (útil en `backups/`).
- Lifecycle en `vc-ingreso/backups/` (p. ej. expirar a 30–90 días).

## 2. Block Public Access

Para permitir bucket policy pública solo en `media/*`:

- Mantener bloqueo de ACLs públicas.
- Desactivar el bloqueo que impide *bucket policies* públicas (en consola: “Block public access to buckets and objects granted through new/any public bucket or access point policies”).

## 3. CORS

```bash
aws s3api put-bucket-cors --bucket crearttech-storage --cors-configuration file://cors.json
```

`cors.json`:

```json
{
  "CORSRules": [
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
}
```

## 4. Bucket policy (media público, backups privados)

```bash
aws s3api put-bucket-policy --bucket crearttech-storage --policy file://bucket-policy.json
```

`bucket-policy.json`:

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

`vc-ingreso/backups/*` no está en la policy → no es público.

## 5. Usuario IAM de la app

1. Crear usuario IAM `vc-ingreso-s3` (acceso programático).
2. Adjuntar política inline:

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

3. Crear access key y ponerla solo en `.env` del servidor (nunca en git).

## 6. Variables de entorno

Ver `.env.example`:

```bash
STORAGE_DRIVER=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=crearttech-storage
S3_KEY_PREFIX=vc-ingreso
S3_MEDIA_PUBLIC_BASE_URL=https://crearttech-storage.s3.us-east-1.amazonaws.com/vc-ingreso/media
```

El servicio `api` las recibe vía `env_file: .env` en Docker Compose.  
En el host de deploy hace falta AWS CLI (mismas credenciales o perfil) para `scripts/deploy-prod.sh`.

## 7. Migración de archivos existentes

Tras configurar prod (bucket + `.env` con `STORAGE_DRIVER=s3`):

```bash
# Preferido en el host (AWS CLI)
./scripts/migrate-uploads-to-s3.sh --dry-run
./scripts/migrate-uploads-to-s3.sh

# Alternativa dentro del contenedor API (montando el script o copiándolo)
docker cp scripts/migrate-uploads-to-s3.php vc-ingreso-api:/tmp/migrate-uploads-to-s3.php
docker exec vc-ingreso-api php /tmp/migrate-uploads-to-s3.php --dry-run
docker exec vc-ingreso-api php /tmp/migrate-uploads-to-s3.php
```

No reescribe la BD: los paths `/uploads/...` se mapean a keys S3.

## 8. Privado en el futuro

1. Quitar la statement `PublicReadMediaOnly` de la bucket policy.
2. Cambiar resolución en `resolveMediaUrl` a URLs firmadas o proxy autenticado (`STORAGE_MEDIA_VISIBILITY=private`).
