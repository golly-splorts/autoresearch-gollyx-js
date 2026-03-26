# Autoresearch: Optimizing ToroidalGOL (JavaScript)

You are an autonomous research agent optimizing a two-color competitive
cellular automata simulator on a toroidal grid. Your goal is to maximize the
number of generations per second that the simulation achieves while preserving
exact correctness.

## Setup

To set up a new experiment, work with the user to:

1. **Agree on a run tag**: propose a tag based on today's date (e.g. `mar5`). The branch `autoresearch/<tag>` must not already exist — this is a fresh run.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current master.
3. **Read the in-scope files**: The repo is small. Read these files for full context:
   - `bench.js` — benchmark harness with hardcoded test case, correctness checkpoints, and evaluation. Do not modify.
   - `program.js` — the file you modify. Contains a toroidal cellular automata class and a runBenchmark entry point.
4. **Initialize results.tsv**: Create `results.tsv` with just the header row. The baseline will be recorded after the first run.
5. **Confirm and go**: Confirm setup looks good.

Once you get confirmation, kick off the experimentation.

## Experimentation

Each experiment will run a cellular automata simulation (B3/S23 Game of Life, 150 x 240 toroidal grid)
for a fixed time budget of 3 minutes.

### Experiment optimization target

- **Metric:** `generations_per_s` (higher is better) is the number of generations per second
  that the simulator sustained over the 3 minute running duration.
- **Hard constraint:** All checkpoint cell counts (team1, team2) must
  exactly match the hardcoded checkpoints in bench.js. Any divergence = FAIL,
  the change is rejected.

### Experiment rules

**What you CAN do:**
- Modify `program.js` - this is the only file you may edit. You may change:
    - Data structures (the sparse row-list representation, Maps, Sets, typed arrays, etc.)
    - Algorithms (neighbor counting, dead-neighbor collection, birth/survival logic)
    - Toroidal wrapping strategy
    - Memory layout and access patterns
    - Typed arrays (`Uint8Array`, `Int32Array`) for dense grid representations
    - Integer key packing (`y * columns + x`) instead of string `"x,y"`
    - `Map` instead of plain object for dead neighbors
    - Precomputed neighbor offset tables
    - Flat array convolution-style neighbor counting
    - Caching, precomputation, lookup tables

**What you CANNOT do:**
- Do not modify `bench.js`. It is read-only. It contains the hardcoded test case, correctness checkpoints, and evaluation harness.
- Do not install new packages or add dependencies. Only use Node.js built-in modules.
- Do not modify the `runBenchmark()` function signature or return format
- Do not modify the cellular automata rules (B3/S23, Game of Life)
- Do not modify the toroidal boundary conditions or grid initial conditions
- Do not modify the two-color team assignments (majority rule, checkerboard tiebreak)
- Do not modify the victory detection (it must continue to work correctly, although you may optimize its implementation)

### Program output format

Once the script finishes, it will output a summary like this in the log file:

```
---
total_generations:  1000
total_walltime:     180
generations_per_s:  5.56
```

Note that the script is configured to always stop after 3 minutes, so depending on the computing platform of this computer the numbers might look different.
You can extract the key metric from the log file:

```
grep "^generations_per_s:" run.log
```

### Logging experiment results

When an experiment is done, log it to `results.tsv` (tab-separated, NOT comma-separated).

The TSV has a header row and 4 columns:

```
commit	generations_per_s	status	description
```

1. git commit hash (short, 7 chars)
2. `generations_per_s` achieved (e.g. 1.234), use 0.000000 for crashes
3. status: `keep`, `discard`, or `crash`
4. short text description of what this experiment tried

### The experiment loop

The experiment runs on a dedicated branch (e.g. `autoresearch/mar5` or `autoresearch/mar5-gpu0`).

LOOP FOREVER:

1. Look at the git state: the current branch/commit we're on
2. Tune `program.js` with an experimental idea by directly hacking the code.
3. git commit
4. Run the experiment/benchmark: `node bench.js > run.log 2>&1` (redirect everything, do NOT use tee or let output flood your context)
5. Read out the results: `grep "^generations_per_s:" run.log`
6. If the grep output is empty, the run crashed. Run `tail -n 50 run.log` to read the stack trace and attempt a fix. If you can't get things to work after more than a few attempts, give up.
7. Record the results in the tsv (NOTE: do not commit the results.tsv file, leave it untracked by git)
8. If `generations_per_s` improved (higher), you "advance" the branch, keeping the git commit
9. If `generations_per_s` did not improve (equal or lower), you git reset back to where you started

### Correctness checkpoints

The benchmark checks cell counts at generations:
0, 1, 2, 3, 4, 5, 60, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 5000

Checkpoints are validated in order from earliest to latest. If your change
breaks the simulation, it will be caught within the first few generations.

This implies:
- A totally wrong algorithm fails at generation 1 (instant feedback)
- An off-by-one or edge case might fail at generation 50 or 100
- Subtle numerical issues might only show at generation 1000+

## Loop

The idea is that you are a completely autonomous researcher trying things out. If they work, keep. If they don't, discard. And you're advancing the branch so that you can iterate. If you feel like you're getting stuck in some way, you can rewind but you should probably do this very very sparingly (if ever).

**Timeout**: Each experiment should take ~3 minutes total (+ a few seconds for startup and eval overhead). If a run exceeds 10 minutes, kill it and treat it as a failure (discard and revert).

**Crashes**: If a run crashes (OOM, or a bug, or etc.), use your judgment: If it's something dumb and easy to fix (e.g. a typo, a missing import), fix it and re-run. If the idea itself is fundamentally broken, just skip it, log "crash" as the status in the tsv, and move on.

**NEVER STOP**: Once the experiment loop has begun (after the initial setup), do NOT pause to ask the human if you should continue. Do NOT ask "should I keep going?" or "is this a good stopping point?". The human might be asleep, or gone from a computer and expects you to continue working *indefinitely* until you are manually stopped. You are autonomous. If you run out of ideas, think harder — read papers referenced in the code, re-read the in-scope files for new angles, try combining previous near-misses, try more radical architectural changes. The loop runs until the human interrupts you, period.

As an example use case, a user might leave you running while they sleep. If each experiment takes you ~5 minutes then you can run approx 12/hour, for a total of about 100 over the duration of the average human sleep. The user then wakes up to experimental results, all completed by you while they slept!


## Addendum

### Known bottlenecks and optimization ideas

The current implementation has several performance characteristics worth
investigating:

1. **Sparse row-list representation** — State is stored as `[[y, x1, x2, ...], ...]`.
   Every `addCell` call does a linear scan. A dict-of-sets or typed array
   could be faster for lookup-heavy operations.

2. **Neighbor counting** — `getNeighborsFromAlive` and `getColorFromAlive`
   do linear scans through the state lists to find adjacent rows. With a
   Map-based structure, neighbor lookups become O(1).

3. **String key construction** — Dead neighbors are tracked via string keys
   like `"x,y"`. Integer key packing (`y * columns + x`) avoids string
   allocation and parsing.

4. **Redundant toroidal wrapping** — Modulo arithmetic is applied repeatedly
   in many methods. Precomputing wrapped coordinates or using a dense grid
   eliminates this overhead.

5. **getCellColor linear scan** — Called once per neighbor per live cell.
   With a color lookup Map or typed array, this becomes O(1).

6. **Dense grid approach** — For a 150×240 grid, a pair of `Uint8Array`s
   (one per team) with direct neighbor counting could be dramatically
   faster than the sparse approach.

### Simplicity criterion

Prefer simple changes with clear wins. A 10-line refactor that gives 2x
speedup is better than a 200-line rewrite that gives 2.1x. If a complex
change produces only marginal improvement, discard it and try something
else.
