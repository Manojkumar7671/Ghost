#!/bin/bash
export GHOST_AUTO_APPROVE=1
echo "Starting server..."
GHOST_DEPLOYMENT_MODE=public node server.js > server.log 2>&1 &
SERVER_PID=$!
sleep 5

echo "=== REAL CODING TASK (/api/agent/run) ==="
curl -s -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"goal": "Please write a simple python script that prints hello.", "user": "demo_guest_99"}' | jq .

echo "Killing server..."
kill $SERVER_PID
