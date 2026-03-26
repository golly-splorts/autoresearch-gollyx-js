"""
bench.py - Benchmark harness for autoresearch optimization of ToroidalGOL.

This file is IMMUTABLE. The autoresearch agent must NOT modify it.

Runs the (possibly modified) program.py for a fixed wall-clock duration,
validates correctness at checkpoints via callback, and reports throughput
in generations per second.

Correctness checkpoints are validated inline during the simulation via a
callback. If any checkpoint fails, the benchmark aborts immediately — this
catches trivial errors in seconds rather than waiting for the full run.

The primary metric is GENERATIONS PER SECOND (higher is better).
"""

import os
import sys
import time

# ---------------------------------------------------------------------------
# Test case: 150x240 grid, "Domino Party" map
# San Francisco Boat Shoes vs Fargo Flea Flickers
# Season 4, Day 3 — game a99d9b78-62f1-4e02-929a-5ee0a84f9770
# Teams interact starting around generation 60.
# ---------------------------------------------------------------------------

S1 = '[{"68":[74,75]},{"69":[13,14,48,75,76,111,112]},{"70":[12,13,22,47,48,75,110,111]},{"71":[13,21,22,48,49,101,102,111]},{"72":[22,23,38,39,102,103]},{"73":[39,40,66,102]},{"74":[39,65,66]},{"75":[66,67]},{"76":[30,31]},{"77":[29,30,85,86,94]},{"78":[30,58,84,85,94,95]},{"79":[57,58,85,93,94]},{"80":[58,59]}]'
S2 = '[{"70":[138]},{"71":[137,138]},{"72":[129,130,138,139,191,192,208,209]},{"73":[128,129,164,165,181,182,190,191,201,209,210,228]},{"74":[129,165,166,173,174,182,183,191,200,201,209,227,228]},{"75":[146,147,156,165,172,173,182,201,202,228,229]},{"76":[147,148,155,156,173]},{"77":[147,156,157,218]},{"78":[217,218]},{"79":[218,219]}]'
ROWS = 150
COLUMNS = 240
TIME_LIMIT_S = 180  # 3 minutes

# Gold-standard checkpoint data: {generation: (team1_livecells, team2_livecells)}
# Dense at start (catch basic GoL errors fast), sparse later.
CHECKPOINTS = {
    0: (60, 60),
    1: (72, 72),
    2: (84, 84),
    3: (108, 108),
    4: (96, 96),
    5: (108, 108),
    60: (301, 365),
    100: (291, 428),
    200: (175, 391),
    300: (125, 514),
    400: (120, 461),
    500: (120, 497),
    600: (150, 507),
    700: (196, 495),
    800: (127, 587),
    900: (120, 594),
    1000: (120, 440),
    2000: (93, 967),
    3000: (92, 1130),
    5000: (259, 921),
}

CHECKPOINT_GENERATIONS = sorted(CHECKPOINTS.keys())

RESULTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.tsv")


def run_and_validate():
    """
    Run the benchmark for TIME_LIMIT_S seconds, validate correctness at
    checkpoints via callback, and report throughput.

    Returns a dict with:
        wall_time_s: float - actual wall clock seconds elapsed
        generations: int - total generations completed
        gen_per_sec: float - generations per second
        correct: bool - whether all checkpoints matched
        failed_at: int or None - first generation that failed, if any
        expected: tuple or None - expected (c1, c2) at failed generation
        actual: tuple or None - actual (c1, c2) at failed generation
    """
    from program import run_benchmark

    # State shared with callback
    failure = {}

    def checkpoint_callback(generation, c1, c2):
        """Return True to continue, False to abort with diagnostics."""
        if generation in CHECKPOINTS:
            expected_c1, expected_c2 = CHECKPOINTS[generation]
            if (c1, c2) != (expected_c1, expected_c2):
                failure["gen"] = generation
                failure["expected"] = (expected_c1, expected_c2)
                failure["actual"] = (c1, c2)
                # Print diagnostics immediately so the autoresearcher sees them
                print(f"\n!! CHECKPOINT MISMATCH at generation {generation} !!")
                print(f"   expected: team1={expected_c1}, team2={expected_c2}")
                print(f"   actual:   team1={c1}, team2={c2}")
                delta1 = c1 - expected_c1
                delta2 = c2 - expected_c2
                print(f"   delta:    team1={delta1:+d}, team2={delta2:+d}")
                if generation > 0:
                    prev_gens = [g for g in CHECKPOINT_GENERATIONS if g < generation]
                    if prev_gens:
                        last_ok = prev_gens[-1]
                        print(f"   last OK checkpoint: generation {last_ok}")
                        print(f"   error emerged in generation range ({last_ok}, {generation}]")
                return False
        return True

    start = time.perf_counter()
    generations = run_benchmark(S1, S2, ROWS, COLUMNS, TIME_LIMIT_S, checkpoint_callback)
    elapsed = time.perf_counter() - start

    gen_per_sec = generations / elapsed if elapsed > 0 else 0.0

    if failure:
        return dict(
            wall_time_s=elapsed,
            generations=generations,
            gen_per_sec=gen_per_sec,
            correct=False,
            failed_at=failure["gen"],
            expected=failure["expected"],
            actual=failure["actual"],
        )

    return dict(
        wall_time_s=elapsed,
        generations=generations,
        gen_per_sec=gen_per_sec,
        correct=True,
        failed_at=None,
        expected=None,
        actual=None,
    )


def append_result(result, notes=""):
    """Append a result row to results.tsv."""
    header = "timestamp\tgenerations\tgen_per_sec\twall_time_s\tcorrect\tfailed_at\tnotes\n"
    if not os.path.exists(RESULTS_FILE):
        with open(RESULTS_FILE, "w") as f:
            f.write(header)

    with open(RESULTS_FILE, "a") as f:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        f.write(
            f"{ts}\t{result['generations']}\t{result['gen_per_sec']:.2f}\t"
            f"{result['wall_time_s']:.4f}\t{result['correct']}\t"
            f"{result['failed_at']}\t{notes}\n"
        )


def main():
    print(f"Running benchmark for {TIME_LIMIT_S}s...")
    result = run_and_validate()

    if result["correct"]:
        print(f"PASS  {result['generations']} generations in {result['wall_time_s']:.2f}s")
        print(f"      {result['gen_per_sec']:.2f} generations/sec")
    else:
        gen = result["failed_at"]
        print(f"FAIL  at generation {gen}")
        print(f"  expected: {result['expected']}")
        print(f"  actual:   {result['actual']}")
        print(f"  ({result['generations']} generations in {result['wall_time_s']:.2f}s)")

    notes = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else ""
    append_result(result, notes)


if __name__ == "__main__":
    main()
