# Fibonacci 100 — saves results to fib_results.txt

def fibonacci(n):
    a, b = 0, 1
    results = []
    for _ in range(n):
        results.append(a)
        a, b = b, a + b
    return results

if __name__ == "__main__":
    fibs = fibonacci(100)
    with open("fib_results.txt", "w") as f:
        for i, val in enumerate(fibs, 1):
            f.write(f"{i}. {val}\n")
    print(f"Wrote {len(fibs)} Fibonacci numbers to fib_results.txt")
