#\!/bin/bash
export NODE_OPTIONS="--dns-result-order=ipv4first"
exec "$@"
