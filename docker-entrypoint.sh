#!/bin/sh
set -e
node migrate.cjs
exec node server.js
