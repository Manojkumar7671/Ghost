#!/bin/bash
echo "Starting server..."
node server.js > server.log 2>&1 &
SERVER_PID=$!
sleep 5

DEMO_USER="demo_guest_99"

echo "=== 2. CODING TASK (/api/agent/run) ==="
curl -s -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"goal": "Please write a simple python script that prints hello.", "user": "'$DEMO_USER'"}' | jq .

echo "Killing server..."
kill $SERVER_PID
