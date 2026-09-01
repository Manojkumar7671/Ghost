#!/bin/bash
node server.js > /tmp/ghost_bypass.log 2>&1 &
SERVER_PID=$!
sleep 5
echo "--- RAW REQUEST ---"
echo "curl -X POST -H \"Content-Type: application/json\" -d '{\"message\": \"hello, are you working?\"}' http://localhost:3000/api/chat"
echo "--- RAW RESPONSE ---"
curl -s -v -X POST -H "Content-Type: application/json" -d '{"message": "hello, are you working?"}' http://localhost:3000/api/chat
echo ""
kill -9 $SERVER_PID
