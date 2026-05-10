#!/bin/bash

DOMAIN="begenchgeldyev.com"
EMAIL="begenchgeldyev@gmail.com"
STAGING=0  # Set to 1 to test with Let's Encrypt staging server

CERT_PATH="/etc/letsencrypt/live/$DOMAIN"

echo "Creating dummy certificate for $DOMAIN..."
docker compose run --rm --entrypoint "" certbot \
  sh -c "mkdir -p $CERT_PATH && \
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout $CERT_PATH/privkey.pem \
      -out $CERT_PATH/fullchain.pem \
      -subj '/CN=localhost'"

echo "Starting nginx..."
docker compose up -d nginx
sleep 2

echo "Deleting dummy certificate..."
docker compose run --rm --entrypoint "" certbot \
  sh -c "rm -rf /etc/letsencrypt/live/$DOMAIN && \
    rm -rf /etc/letsencrypt/archive/$DOMAIN && \
    rm -rf /etc/letsencrypt/renewal/$DOMAIN.conf"

echo "Requesting real certificate for $DOMAIN..."

if [ "$STAGING" = "1" ]; then
  STAGING_FLAG="--staging"
else
  STAGING_FLAG=""
fi

docker run --rm \
  -v begenchgeldyev_certbot-webroot:/var/www/certbot \
  -v begenchgeldyev_certbot-certs:/etc/letsencrypt \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  $STAGING_FLAG

echo "Reloading nginx with real certificate..."
docker compose exec nginx nginx -s reload

echo "Done! SSL certificate installed for $DOMAIN"
