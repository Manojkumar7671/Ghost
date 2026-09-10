#!/bin/bash
echo "Starting server..."
node server.js > server.log 2>&1 &
SERVER_PID=$!
sleep 5

echo "=== MALFORMED /api/chat (Missing message) ==="
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"username": "demo"}' | jq .

echo "=== MALFORMED /api/agent/run (Missing goal) ==="
curl -s -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"user": "demo"}' | jq .

echo "=== MALFORMED JSON /api/agent/run ==="
curl -s -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{bad_json'

echo ""

echo "Killing server..."
kill $SERVER_PID
