#!/bin/bash
unset GHOST_AUTO_APPROVE
echo "Starting server..."
GHOST_DEPLOYMENT_MODE=public node server.js > server.log 2>&1 &
SERVER_PID=$!
sleep 5

echo "=== SENDING RISKY GOAL TO /api/agent/run ==="
# Launch the agent run in the background so we can approve it while it waits
curl -s -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"goal": "Please send an email.", "user": "demo_guest_99"}' > hardgate_response.json &
RUN_PID=$!

sleep 3
echo "=== CHECKING APPROVAL STATE ==="
sqlite3 mini-swe-agent/ghost_agent_runs.db "SELECT * FROM pending_approvals ORDER BY created_at DESC LIMIT 1;"

echo "=== APPROVING ACTION ==="
APPROVAL_ID=$(sqlite3 mini-swe-agent/ghost_agent_runs.db "SELECT approval_id FROM pending_approvals ORDER BY created_at DESC LIMIT 1;")
echo "Approving ID: $APPROVAL_ID"
cd mini-swe-agent && uv run --python 3.11 python src/minisweagent/approvals.py resolve "$APPROVAL_ID" APPROVED
cd ..

# Wait for agent run to finish
wait $RUN_PID

echo "=== AGENT RUN RESPONSE ==="
cat hardgate_response.json | jq .

echo "Killing server..."
kill $SERVER_PID
