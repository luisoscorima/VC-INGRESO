#!/bin/sh
# Crea directorios de subida y storage, y asigna permisos para Apache (www-data).
# Necesario cuando se usan volúmenes nombrados en Docker.
set -e
mkdir -p /var/www/html/uploads/public/vehicles /var/www/html/uploads/public/pets /var/www/html/uploads/public/profiles /var/www/html/uploads/incidents /var/www/html/uploads/pets
mkdir -p /var/www/html/storage
chown -R www-data:www-data /var/www/html/uploads
chown -R www-data:www-data /var/www/html/storage
if [ "$#" -eq 0 ]; then
	set -- apache2-foreground
fi
exec "$@"
