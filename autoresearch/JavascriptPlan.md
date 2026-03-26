# Plan: Adapt Autoresearch for JavaScript Simulator

## Context

The existing autoresearch system optimizes `program.py` using `bench.py` as an immutable benchmark harness. We want to do the same for a JavaScript version: create `program.js` (mutable, agent optimizes this) and `bench.js` (immutable harness with hardcoded checkpoints).

## Files to Create

| File | Role | Mutable? |
|------|------|----------|
| `program.js` | Simulation module extracted from `simulator.js` | Yes (agent modifies) |
| `bench.js` | Benchmark harness (port of `bench.py`) | No (immutable) |
| `program.md` | Updated agent instructions | N/A |

## Step 1: Create `program.js`

Extract pure simulation logic from `simulator.js` into a standalone CommonJS module.

### Structure

```
function ToroidalGOL(s1, s2, rows, columns) { ... }
ToroidalGOL.prototype.prepare = function(s1, s2) { ... };
ToroidalGOL.prototype.nextGeneration = function() { ... };
ToroidalGOL.prototype.getLiveCounts = function() { ... };
ToroidalGOL.prototype.getNeighborsFromAlive = function(...) { ... };
ToroidalGOL.prototype.getColorFromAlive = function(x, y) { ... };
ToroidalGOL.prototype.getCellColor = function(x, y) { ... };
ToroidalGOL.prototype.addCell = function(x, y, state) { ... };
ToroidalGOL.prototype.removeCell = function(x, y, state) { ... };
ToroidalGOL.prototype.isAlive = function(x, y) { ... };
ToroidalGOL.prototype.periodicNormalizex = function(j) { ... };
ToroidalGOL.prototype.periodicNormalizey = function(j) { ... };

function runBenchmark(s1, s2, rows, columns, timeLimitS, checkpointCallback) { ... }
module.exports = { runBenchmark };
```

### Transformations from `simulator.js`

| Original | Change |
|----------|--------|
| `GOL.rows` / `GOL.columns` | `this.rows` / `this.columns` |
| `GOL.ruleParams.s` / `GOL.ruleParams.b` | `this.ruleS` / `this.ruleB` (hardcoded `[2,3]` / `[3]`) |
| `this.redrawList` | Remove entirely (rendering only) |
| `getColorFromAlive` returns `0` on tie | Fix: `(x % 2 === y % 2) ? 1 : 2` (see Divergence.md) |
| IIFE + global `GOL` object | Constructor function + prototype methods |

### Methods to extract (from `GOL.listLife` in `simulator.js`)

- `nextGeneration` (line 1732) — core step function
- `getLiveCounts` (line 1673) — count live cells per team
- `getNeighborsFromAlive` (line 2065) — neighbor counting + majority color
- `getColorFromAlive` (line 1904) — color for born cells (**with tiebreak fix**)
- `getCellColor` (line 2284) — color lookup
- `addCell` (~line 2341) — insert into sparse row-list
- `removeCell` (~line 2313) — remove from sparse row-list
- `isAlive` (line 2258) — check if cell alive
- `periodicNormalizex` / `periodicNormalizey` — toroidal wrapping

### Initialization

Port from `GOL.setInitialState` (lines 780-806): parse JSON `[{"y":[x1,x2,...]}, ...]` format, call `addCell` for each cell into `actualState` + team-specific state.

### `runBenchmark` entry point

Mirrors `program.py` lines 587-626:
- Construct `ToroidalGOL(s1, s2, rows, columns)`
- Call `checkpointCallback(0, liveCells1, liveCells2)` for generation 0
- Loop: call `nextGeneration()`, increment generation, call callback, check time deadline
- Return total generations completed
- Use `performance.now()` from `perf_hooks` for timing

## Step 2: Create `bench.js`

Direct port of `bench.py` to Node.js. This file is immutable.

### Contents
- Same S1, S2 JSON strings from `bench.py` (lines 28-29)
- ROWS=150, COLUMNS=240, TIME_LIMIT_S=180
- Same CHECKPOINTS (copy exact values from `bench.py` lines 36-57)
- `runAndValidate()` — `require('./program.js')`, pass checkpoint callback
- `appendResult()` — append to `results.tsv` via `fs`
- `main()` — print PASS/FAIL and gen/sec
- Uses `performance.now()` from `perf_hooks`

### Output format
```
generations_per_s:  X.XX
```
(Same format as Python version so grep command in program.md works unchanged)

### Run command
```
node bench.js > run.log 2>&1
```

## Step 3: Verify Checkpoints

The Python checkpoint values from `bench.py` should be reusable after the `getColorFromAlive` tiebreak fix is applied.

1. Run `node bench.js` — all 20 checkpoints should pass
2. If generation 0 fails → initialization bug
3. If generation 1-5 fails → `nextGeneration` logic difference
4. If later generations fail → subtle iteration order or edge case divergence

If checkpoints don't match despite the tiebreak fix, debug by comparing cell-by-cell output at the failing generation against the Python version.

## Step 4: Update `program.md`

Key changes from current version:
- `program.py` → `program.js`, `bench.py` → `bench.js`
- Remove "Using Pypy" section; replace with note about Node.js
- Run command: `node bench.js > run.log 2>&1`
- Update optimization ideas for JS:
  - Typed arrays (`Uint8Array`) for dense grid
  - Integer key packing (`y * columns + x`) instead of string `"x,y"`
  - `Map` instead of plain object for dead neighbors
  - Precomputed neighbor offset tables
  - Flat array convolution-style neighbor counting
- Keep same experiment loop, logging format, constraints
