# Backend PHP image for VC-INGRESO
# Simple Apache + PHP 8.2 with PDO MySQL

FROM php:8.2-apache

# Install extensions
RUN docker-php-ext-install pdo pdo_mysql mysqli

# Silence ServerName warning; enable mod_rewrite and mod_headers for .htaccess (CORS)
RUN echo 'ServerName localhost' > /etc/apache2/conf-available/servername.conf \
    && a2enconf servername \
    && a2enmod rewrite \
    && a2enmod headers \
    && a2enmod remoteip

# PHP configuration
RUN { \
    echo 'opcache.enable=${PHP_OPCACHE_ENABLE:-1}'; \
    echo 'opcache.enable_cli=0'; \
    echo 'opcache.validate_timestamps=${PHP_OPCACHE_VALIDATE_TIMESTAMPS:-0}'; \
    echo 'opcache.max_accelerated_files=20000'; \
    echo 'opcache.memory_consumption=128'; \
    echo 'opcache.interned_strings_buffer=16'; \
    echo 'cgi.fix_pathinfo=0'; \
    echo 'expose_php=0'; \
    echo 'memory_limit=256M'; \
    echo 'post_max_size=21M'; \
    echo 'upload_max_filesize=20M'; \
    echo 'date.timezone=America/Lima'; \
    echo 'session.cookie_httponly=1'; \
    echo 'session.cookie_samesite=Lax'; \
} > /usr/local/etc/php/conf.d/custom.ini

# Allow .htaccess (rewrite to index.php)
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

# Copy backend source
WORKDIR /var/www/html
COPY server/ ./

# Apache: IP real del cliente vía X-Forwarded-For (NPM / reverse proxy)
COPY server/apache-remoteip.conf /etc/apache2/conf-available/remoteip.conf
RUN a2enconf remoteip

# Entrypoint: crea uploads/public/{vehicles,pets} y asigna permisos (para volumen en Docker)
COPY server/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Permissions
RUN chown -R www-data:www-data /var/www/html

EXPOSE 80
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["apache2-foreground"]
