#!/bin/sh
# Crea directorio storage y permisos para Apache (www-data).
# El media vive en S3; ya no se usa volumen local de uploads.
set -e
mkdir -p /var/www/html/storage
chown -R www-data:www-data /var/www/html/storage
if [ "$#" -eq 0 ]; then
	set -- apache2-foreground
fi
exec "$@"
