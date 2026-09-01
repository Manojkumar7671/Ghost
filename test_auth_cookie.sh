#!/bin/bash
node server.js > /tmp/ghost_auth2.log 2>&1 &
SERVER_PID=$!
sleep 5

PASSPHRASE=$(grep ADMIN_PASSPHRASE .env | cut -d '=' -f 2)

echo "--- RAW LOGIN REQUEST ---"
echo "curl -c cookie.txt -X POST -H \"Content-Type: application/json\" -d '{\"passphrase\": \"[REDACTED]\"}' http://localhost:3000/api/auth/login"
echo "--- RAW LOGIN RESPONSE ---"
curl -s -v -c cookie.txt -X POST -H "Content-Type: application/json" -d "{\"passphrase\": \"$PASSPHRASE\"}" http://localhost:3000/api/auth/login
echo ""

echo "--- RAW CHAT REQUEST ---"
echo "curl -b cookie.txt -v -X POST -H \"Content-Type: application/json\" -d '{\"message\": \"hello, are you working?\"}' http://localhost:3000/api/chat"
echo "--- RAW CHAT RESPONSE ---"
curl -s -v -b cookie.txt -X POST -H "Content-Type: application/json" -d '{"message": "hello, are you working?"}' http://localhost:3000/api/chat
echo ""

kill -9 $SERVER_PID
echo "--- SERVER LOGS ---"
grep -iE "brain|llm|nvidia|trace|routing plain" /tmp/ghost_auth2.log || tail -n 20 /tmp/ghost_auth2.log
