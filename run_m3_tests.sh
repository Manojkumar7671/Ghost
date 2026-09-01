cd mini-swe-agent
echo "--- TEST 1: PROBE SUCCESS ---" > ../m3_test.log
PYTHONUNBUFFERED=1 uv run --python 3.11 python ../scripts/milestone3_gateway.py probe_success >> ../m3_test.log 2>&1

echo -e "\n\n--- TEST 2: PROBE FAIL & FALLBACK ---" >> ../m3_test.log
PYTHONUNBUFFERED=1 uv run --python 3.11 python ../scripts/milestone3_gateway.py probe_fail >> ../m3_test.log 2>&1

echo -e "\n\n--- TEST 3: PEVR THROUGH GATEWAY ---" >> ../m3_test.log
PYTHONUNBUFFERED=1 uv run --python 3.11 python ../scripts/milestone3_gateway.py pevr_success >> ../m3_test.log 2>&1
