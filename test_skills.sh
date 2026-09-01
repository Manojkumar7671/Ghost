#!/bin/bash
node server.js > /tmp/ghost_skills.log 2>&1 &
SERVER_PID=$!
sleep 5

PASSPHRASE=$(grep ADMIN_PASSPHRASE .env | cut -d '=' -f 2)
curl -s -c cookie.txt -X POST -H "Content-Type: application/json" -d "{\"passphrase\": \"$PASSPHRASE\"}" http://localhost:3000/api/auth/login > /dev/null

echo "--- RAW REQUEST ---"
echo "curl -v -b cookie.txt http://localhost:3000/api/skills"
echo "--- RAW RESPONSE ---"
curl -s -v -b cookie.txt http://localhost:3000/api/skills
echo ""

kill -9 $SERVER_PID
