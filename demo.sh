#!/bin/bash
echo "Starting server..."
node server.js > server.log 2>&1 &
SERVER_PID=$!
sleep 5

DEMO_USER="demo_guest_99"

echo "=== 1. CHAT ==="
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello! I am just starting this demo.", "username": "'$DEMO_USER'"}' | jq .

echo "Killing server..."
kill $SERVER_PID
