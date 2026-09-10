import time
import requests
import concurrent.futures
import subprocess
import os

URL = "http://localhost:3000/api/chat"
NUM_REQUESTS = 8

def make_request(i):
    start = time.time()
    try:
        resp = requests.post(
            URL,
            json={"message": f"Hello from user {i}", "user": f"load_user_{i}"},
            timeout=30
        )
        elapsed = time.time() - start
        return i, resp.status_code, elapsed, resp.text
    except Exception as e:
        elapsed = time.time() - start
        return i, "ERROR", elapsed, str(e)

print("=== STARTING CONCURRENT REQUESTS ===")
with concurrent.futures.ThreadPoolExecutor(max_workers=NUM_REQUESTS) as executor:
    futures = [executor.submit(make_request, i) for i in range(1, NUM_REQUESTS + 1)]
    
    # Wait half a second for requests to hit the server
    time.sleep(0.5)
    print("\n=== SERVER RESOURCE USAGE (during test) ===")
    os.system("ps aux | grep 'node server.js' | grep -v grep | awk '{print \"CPU: \" $3 \"% | MEM: \" $4 \"% | RSS: \" $6 \" KB\"}'")
    print("===========================================")

    results = [f.result() for f in concurrent.futures.as_completed(futures)]

print("\n=== LOAD TEST RESULTS ===")
for i, status, elapsed, text in sorted(results):
    print(f"Request {i:02d} | HTTP {status} | Time: {elapsed:.3f}s")
    if str(status) != "200":
        print(f"  -> Error details: {text[:200]}")

print("\n=== FINAL HEALTH CHECK ===")
start = time.time()
try:
    resp = requests.post(URL, json={"message": "Final check, are you alive?", "user": "health_check"}, timeout=10)
    elapsed = time.time() - start
    print(f"Health Check | HTTP {resp.status_code} | Time: {elapsed:.3f}s")
    print(f"Response: {resp.text}")
except Exception as e:
    print(f"Health Check Failed: {e}")
