#!/bin/bash
echo "Starting server..."
GHOST_DEPLOYMENT_MODE=public node server.js > server.log 2>&1 &
SERVER_PID=$!
sleep 5

DEMO_USER="demo_guest_99"

echo "=== 1. CHAT ==="
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello! I am just starting this demo.", "username": "'$DEMO_USER'"}' | jq .

echo ""
sleep 2
echo "=== 2. CODING TASK ==="
curl -s -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"goal": "Please write a simple python script that prints hello.", "user": "'$DEMO_USER'"}' | jq .

echo ""
sleep 2
echo "=== 3. MEMORY RECALL ==="
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What did I say when I started the demo?", "username": "'$DEMO_USER'"}' | jq .

echo ""
sleep 2
echo "=== 4. RISKY ACTION (APPROVAL GATE) ==="
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Please delete the entire src directory right now.", "username": "'$DEMO_USER'"}' | jq .

echo ""
sleep 2
echo "=== 5. MALFORMED /api/chat ==="
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"username": "'$DEMO_USER'"}' | jq .

echo ""
sleep 2
echo "=== 6. MALFORMED JSON /api/agent/run ==="
curl -s -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{bad_json' | jq .

echo ""
echo "Killing server..."
kill $SERVER_PID
