#!/bin/bash
node server.js > server_test.log 2>&1 &
SERVER_PID=$!
echo "Server started with PID $SERVER_PID"
sleep 130
kill $SERVER_PID
echo "Server stopped."
