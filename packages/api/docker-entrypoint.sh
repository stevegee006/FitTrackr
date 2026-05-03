#!/bin/sh

echo "Running database migrations..."
cd /app/packages/api
if ! npx prisma migrate deploy; then
  echo "migrate deploy failed — attempting db push as fallback..."
  npx prisma db push --skip-generate || echo "WARNING: db push also failed, starting anyway"
fi

echo "Starting API server..."
cd /app
exec node packages/api/dist/index.js
