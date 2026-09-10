#!/bin/bash
echo "Starting server..."
GHOST_DEPLOYMENT_MODE=public GHOST_AUTO_APPROVE=1 node server.js > server_coding.log 2>&1 &
SERVER_PID=$!
sleep 5

echo "=== SENDING CODING GOAL TO /api/agent/run ==="
curl -s -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"goal": "write a simple python script that prints hello.", "user": "demo_guest_99"}' > coding_response_live.json

echo "=== AGENT RUN RESPONSE ==="
cat coding_response_live.json | jq .

echo "Killing server..."
kill $SERVER_PID
