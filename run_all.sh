cd mini-swe-agent
echo "--- TEST 1: SUCCESS ---" > ../pevr_test.log
PYTHONUNBUFFERED=1 uv run --python 3.11 python ../scripts/milestone2_pevr.py success >> ../pevr_test.log 2>&1
echo -e "\n\n--- TEST 2: DELIBERATE FAILURE ---" >> ../pevr_test.log
PYTHONUNBUFFERED=1 uv run --python 3.11 python ../scripts/milestone2_pevr.py failure >> ../pevr_test.log 2>&1
echo -e "\n\n--- TEST 3: BUDGET ENFORCEMENT ---" >> ../pevr_test.log
PYTHONUNBUFFERED=1 uv run --python 3.11 python ../scripts/milestone2_pevr.py budget >> ../pevr_test.log 2>&1
