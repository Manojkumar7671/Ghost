#!/bin/bash
node server.js > /tmp/ghost_auth.log 2>&1 &
SERVER_PID=$!
sleep 5

PASSPHRASE=$(grep ADMIN_PASSPHRASE .env | cut -d '=' -f 2)

echo "--- RAW LOGIN REQUEST ---"
echo "curl -X POST -H \"Content-Type: application/json\" -d '{\"passphrase\": \"[REDACTED]\"}' http://localhost:3000/api/login"
echo "--- RAW LOGIN RESPONSE ---"
LOGIN_RES=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"passphrase\": \"$PASSPHRASE\"}" http://localhost:3000/api/login)
echo $LOGIN_RES
echo ""

TOKEN=$(echo $LOGIN_RES | grep -o '"token":"[^"]*' | grep -o '[^"]*$')

echo "--- RAW CHAT REQUEST ---"
echo "curl -v -X POST -H \"Content-Type: application/json\" -H \"Authorization: Bearer <token>\" -d '{\"message\": \"hello, are you working?\"}' http://localhost:3000/api/chat"
echo "--- RAW CHAT RESPONSE ---"
curl -s -v -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"message": "hello, are you working?"}' http://localhost:3000/api/chat
echo ""

kill -9 $SERVER_PID
echo "--- SERVER LOGS (grep brain|LLM|NVIDIA|trace) ---"
grep -iE "brain|llm|nvidia|trace|routing plain" /tmp/ghost_auth.log || tail -n 20 /tmp/ghost_auth.log
