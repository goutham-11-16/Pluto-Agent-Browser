"""Speed test: Run 'open google' twice to measure first-run vs repeat-run performance."""
import time

import httpx


def run_test(label: str):
    print(f"\n{'='*50}")
    print(f"  {label}")
    print(f"{'='*50}")
    t0 = time.monotonic()
    first_step_time = None

    with httpx.Client(timeout=120.0) as client:
        with client.stream("GET", "http://localhost:18420/api/run", params={
            "task": "open google",
            "model": "",
            "url": "about:blank"
        }) as response:
            for line in response.iter_lines():
                elapsed = time.monotonic() - t0
                if line.startswith("data: "):
                    data = line[6:].strip()
                    if data and data != "{}":
                        if first_step_time is None and "Step 1" in data:
                            first_step_time = elapsed
                        preview = data[:100] + "..." if len(data) > 100 else data
                        print(f"  [{elapsed:6.2f}s] {preview}")
                    if '"type": "done"' in data or '"type": "error"' in data:
                        break

    total = time.monotonic() - t0
    print(f"\n  -> Time to first step: {first_step_time:.2f}s" if first_step_time else "  -> No steps executed")
    print(f"  -> TOTAL: {total:.2f}s\n")
    return total

t1 = run_test("RUN 1 (cold start — new browser.start())")
time.sleep(2)  # brief pause between runs
t2 = run_test("RUN 2 (warm — browser already connected)")

print(f"\n{'='*50}")
print("  SUMMARY")
print(f"{'='*50}")
print(f"  Run 1 (cold): {t1:.2f}s")
print(f"  Run 2 (warm): {t2:.2f}s")
print(f"  Speedup: {t1/t2:.1f}x faster on repeat")
print(f"{'='*50}")
