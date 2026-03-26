# autoresearch-gollyx-js

Autonomous optimization of the gollyx-xyz-pelican two-color toroidal Game of Life simulator, using the [Karpathy autoresearch](https://github.com/karpathy/autoresearch) pattern.

## How it works

An LLM agent iteratively modifies `program.js` to reduce wall-clock simulation time, validated against known-good checkpoint data at every step.

| File | Role |
|---|---|
| `program.js` | Self-contained ToroidalGOL simulator. **Only file the agent modifies.** |
| `bench.js` | Benchmark harness + correctness validation. Immutable. |
| `program.md` | Prompt that guides the LLM agent. |
| `results.tsv` | Experiment log (appended automatically). |

## Environment

The simulator is pure algorithmic JavaScript — no DOM, no browser APIs, no npm
dependencies. It runs under plain Node.js using only built-in modules
(`perf_hooks` for timing, `fs` for file I/O).

Node version is pinned via `.nvmrc`. To use the correct version:

```bash
nvm use          # reads .nvmrc, switches to pinned Node version
node --version   # verify
```

## Running a benchmark

```bash
cd autoresearch
node bench.js > run.log 2>&1
grep "^generations_per_s:" run.log
```

Expected output (numbers vary by machine):

```
generations_per_s:  5.56
```

The benchmark runs for 3 minutes, validates correctness checkpoints, then
reports generations per second.

## Correctness

Checkpoints are hardcoded in `bench.js` and validated at generations 0, 1, 2,
3, 4, 5, 60, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000,
5000 — earliest first, so broken changes fail fast.
