#!/bin/bash
echo "Starting server..."
GHOST_DEPLOYMENT_MODE=public node server.js > server_load.log 2>&1 &
SERVER_PID=$!
sleep 5 # wait for boot

echo "Running load test script..."
uv run --python 3.11 python load_test.py

echo "Killing server..."
kill $SERVER_PID
