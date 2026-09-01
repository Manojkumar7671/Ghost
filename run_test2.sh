cd mini-swe-agent
echo "--- TEST 2: DELIBERATE FAILURE ---" > ../pevr_test2.log
PYTHONUNBUFFERED=1 uv run --python 3.11 python ../scripts/milestone2_pevr.py failure >> ../pevr_test2.log 2>&1
