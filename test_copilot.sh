#!/bin/bash
node server.js > /tmp/ghost_copilot.log 2>&1 &
SERVER_PID=$!
sleep 5

PASSPHRASE=$(grep ADMIN_PASSPHRASE .env | cut -d '=' -f 2)

curl -s -c cookie.txt -X POST -H "Content-Type: application/json" -d "{\"passphrase\": \"$PASSPHRASE\"}" http://localhost:3000/api/auth/login > /dev/null

echo "--- RAW REQUEST ---"
echo "curl -v -b cookie.txt -X POST -H \"Content-Type: application/json\" -d '{\"message\": \"write a function to reverse a linked list in JS\"}' http://localhost:3000/api/coding-copilot"
echo "--- RAW RESPONSE ---"
curl -s -v -b cookie.txt -X POST -H "Content-Type: application/json" -d '{"message": "write a function to reverse a linked list in JS"}' http://localhost:3000/api/coding-copilot
echo ""

kill -9 $SERVER_PID
echo "--- SERVER LOGS ---"
grep -iE "brain|llm|nvidia|trace|routing plain|copilot" /tmp/ghost_copilot.log || tail -n 20 /tmp/ghost_copilot.log
