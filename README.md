# autoresearch-gollyx-js

Autonomous optimization of the gollyx-xyz-pelican two-color toroidal Game of Life simulator, using the [Karpathy autoresearch](https://github.com/karpathy/autoresearch) pattern.

## How it works

An LLM agent iteratively modifies `program.js` to reduce wall-clock simulation time, validated against known-good checkpoint data at every step.

| File | Role |
|---|---|
| `program.js` | Self-contained ToroidalGOL simulator. **Only file the agent modifies.** |
| `bench.py` | Benchmark harness + correctness validation. Immutable. |
| `program.md` | Prompt that guides the LLM agent. |
| `results.tsv` | Experiment log (appended automatically). |

## Running a benchmark

TODO

## Correctness

Checkpoints are hardcoded in `bench.py` and validated at generations 0, 1, 2, 3, 4, 5, 60, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 5000 — earliest first, so broken changes fail fast.
