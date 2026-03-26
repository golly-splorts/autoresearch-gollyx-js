/**
 * program.js - Self-contained two-color toroidal Game of Life simulator.
 *
 * Hybrid dense grid + live cell list. Pre-allocated buffers, ring buffer
 * for moving avg, reused result object, fill(0) instead of dirty tracking.
 */

const EQUALTOL = 1e-8;
const SMOL = 1e-12;

function ToroidalGOL(s1, s2, rows, columns) {
  if (typeof s1 === 'string') s1 = JSON.parse(s1);
  if (typeof s2 === 'string') s2 = JSON.parse(s2);

  this.rows = rows;
  this.columns = columns;
  this.maxdim = 280;
  this.running = true;
  this.generation = 0;
  this.foundVictor = false;
  this.whoWon = 0;

  // Ring buffer for moving average
  this.ringBuf = new Float64Array(this.maxdim);
  this.ringIdx = 0;
  this.ringFull = false;
  this.ringSum = 0;
  this.runningAvgLast3 = [0, 0, 0];

  var size = rows * columns;
  this.size = size;
  // Double-buffered color grids (0=dead, 1=team1, 2=team2)
  this.colorA = new Uint8Array(size);
  this.colorB = new Uint8Array(size);
  this.color = this.colorA;
  this.useA = true;

  // Pre-allocated work buffers
  this.neighborCount = new Int32Array(size);
  this.neighbor1Count = new Int32Array(size);
  this.checked = new Uint8Array(size);

  // Live cell lists (pre-allocate)
  this.liveCells = new Int32Array(size);
  this.liveCount = 0;
  this.newLiveCells = new Int32Array(size);

  // Reusable result object
  this._liveCountsResult = {
    generation: 0, liveCells: 0, liveCells1: 0, liveCells2: 0,
    victoryPct: 0, coverage: 0, territory1: 0, territory2: 0,
    last3: this.runningAvgLast3,
  };

  // Precompute wrapped coords
  this.rowUp = new Int32Array(rows);
  this.rowDown = new Int32Array(rows);
  this.colLeft = new Int32Array(columns);
  this.colRight = new Int32Array(columns);

  for (var y = 0; y < rows; y++) {
    this.rowUp[y] = y === 0 ? rows - 1 : y - 1;
    this.rowDown[y] = y === rows - 1 ? 0 : y + 1;
  }
  for (var x = 0; x < columns; x++) {
    this.colLeft[x] = x === 0 ? columns - 1 : x - 1;
    this.colRight[x] = x === columns - 1 ? 0 : x + 1;
  }

  this._prepare(s1, s2);
}

ToroidalGOL.prototype._prepare = function (s1, s2) {
  var cols = this.columns;
  var color = this.color;
  var liveCells = this.liveCells;
  var lc = 0;

  for (var ri = 0; ri < s1.length; ri++) {
    var s1row = s1[ri];
    var keys = Object.keys(s1row);
    for (var ki = 0; ki < keys.length; ki++) {
      var y = parseInt(keys[ki], 10);
      var xs = s1row[keys[ki]];
      for (var xi = 0; xi < xs.length; xi++) {
        var idx = y * cols + xs[xi];
        color[idx] = 1;
        liveCells[lc++] = idx;
      }
    }
  }

  for (var ri = 0; ri < s2.length; ri++) {
    var s2row = s2[ri];
    var keys = Object.keys(s2row);
    for (var ki = 0; ki < keys.length; ki++) {
      var y = parseInt(keys[ki], 10);
      var xs = s2row[keys[ki]];
      for (var xi = 0; xi < xs.length; xi++) {
        var idx = y * cols + xs[xi];
        color[idx] = 2;
        liveCells[lc++] = idx;
      }
    }
  }

  this.liveCount = lc;
  var livecounts = this.getLiveCounts();
  this.updateMovingAvg(livecounts);
};

ToroidalGOL.prototype.updateMovingAvg = function (livecounts) {
  if (this.foundVictor) return;

  var maxdim = this.maxdim;
  var val = livecounts.victoryPct;

  if (!this.ringFull) {
    this.ringBuf[this.ringIdx] = val;
    this.ringSum += val;
    this.ringIdx++;
    if (this.ringIdx >= maxdim) {
      this.ringFull = true;
      this.ringIdx = 0;
    }
  } else {
    var oldVal = this.ringBuf[this.ringIdx];
    this.ringBuf[this.ringIdx] = val;
    this.ringSum += val - oldVal;
    this.ringIdx = (this.ringIdx + 1) % maxdim;

    var runningAvg = this.ringSum / maxdim;

    var removed = this.runningAvgLast3[0];
    this.runningAvgLast3[0] = this.runningAvgLast3[1];
    this.runningAvgLast3[1] = this.runningAvgLast3[2];
    this.runningAvgLast3[2] = runningAvg;

    var tol = EQUALTOL;
    if (!this.approxEqual(removed, 0.0, tol)) {
      var b1 = this.approxEqual(this.runningAvgLast3[0], this.runningAvgLast3[1], tol);
      var b2 = this.approxEqual(this.runningAvgLast3[1], this.runningAvgLast3[2], tol);
      var zerocells = (livecounts.liveCells1 === 0 || livecounts.liveCells2 === 0);
      if ((b1 && b2) || zerocells) {
        var z1 = this.approxEqual(this.runningAvgLast3[0], 50.0, tol);
        var z2 = this.approxEqual(this.runningAvgLast3[1], 50.0, tol);
        var z3 = this.approxEqual(this.runningAvgLast3[2], 50.0, tol);
        if ((!(z1 || z2 || z3)) || zerocells) {
          if (livecounts.liveCells1 > livecounts.liveCells2) {
            this.foundVictor = true;
            this.whoWon = 1;
          } else if (livecounts.liveCells1 < livecounts.liveCells2) {
            this.foundVictor = true;
            this.whoWon = 2;
          }
        }
      }
    }
  }
};

ToroidalGOL.prototype.approxEqual = function (a, b, tol) {
  var denom = Math.max(Math.abs(a), Math.abs(b), SMOL);
  return (Math.abs(a - b) / denom) < tol;
};

ToroidalGOL.prototype._nextGenerationLogic = function () {
  var cols = this.columns;
  var color = this.color;
  var liveCells = this.liveCells;
  var numLive = this.liveCount;
  var rowUp = this.rowUp;
  var rowDown = this.rowDown;
  var colLeft = this.colLeft;
  var colRight = this.colRight;
  var neighborCount = this.neighborCount;
  var neighbor1Count = this.neighbor1Count;
  var checked = this.checked;

  // Phase 1: Accumulate neighbor counts
  for (var li = 0; li < numLive; li++) {
    var idx = liveCells[li];
    var y = (idx / cols) | 0;
    var x = idx - y * cols;
    var ym1Off = rowUp[y] * cols;
    var yOff = y * cols;
    var yp1Off = rowDown[y] * cols;
    var xm1 = colLeft[x];
    var xp1 = colRight[x];

    neighborCount[ym1Off + xm1]++;
    neighborCount[ym1Off + x]++;
    neighborCount[ym1Off + xp1]++;
    neighborCount[yOff + xm1]++;
    neighborCount[yOff + xp1]++;
    neighborCount[yp1Off + xm1]++;
    neighborCount[yp1Off + x]++;
    neighborCount[yp1Off + xp1]++;

    if (color[idx] === 1) {
      neighbor1Count[ym1Off + xm1]++;
      neighbor1Count[ym1Off + x]++;
      neighbor1Count[ym1Off + xp1]++;
      neighbor1Count[yOff + xm1]++;
      neighbor1Count[yOff + xp1]++;
      neighbor1Count[yp1Off + xm1]++;
      neighbor1Count[yp1Off + x]++;
      neighbor1Count[yp1Off + xp1]++;
    }
  }

  // Phase 2: Determine new state
  var newColor = this.useA ? this.colorB : this.colorA;
  var newLiveCells = this.newLiveCells;
  var newCount = 0;

  for (var li = 0; li < numLive; li++) {
    var idx = liveCells[li];
    var n = neighborCount[idx];

    if (n === 2 || n === 3) {
      var n1 = neighbor1Count[idx];
      var n2 = n - n1;
      if (n1 > n2) {
        newColor[idx] = 1;
      } else if (n2 > n1) {
        newColor[idx] = 2;
      } else {
        var y = (idx / cols) | 0;
        var x = idx - y * cols;
        newColor[idx] = (x % 2 === y % 2) ? 1 : 2;
      }
      newLiveCells[newCount++] = idx;
    }

    var y = (idx / cols) | 0;
    var x = idx - y * cols;
    var ym1Off = rowUp[y] * cols;
    var yOff = y * cols;
    var yp1Off = rowDown[y] * cols;
    var xm1 = colLeft[x];
    var xp1 = colRight[x];

    var nIdx;

    nIdx = ym1Off + xm1;
    if (color[nIdx] === 0 && !checked[nIdx]) {
      checked[nIdx] = 1;
      if (neighborCount[nIdx] === 3) {
        var nn1 = neighbor1Count[nIdx];
        if (nn1 > 1) { newColor[nIdx] = 1; }
        else if (nn1 < 2) { newColor[nIdx] = 2; }
        else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
        newLiveCells[newCount++] = nIdx;
      }
    }

    nIdx = ym1Off + x;
    if (color[nIdx] === 0 && !checked[nIdx]) {
      checked[nIdx] = 1;
      if (neighborCount[nIdx] === 3) {
        var nn1 = neighbor1Count[nIdx];
        if (nn1 > 1) { newColor[nIdx] = 1; }
        else if (nn1 < 2) { newColor[nIdx] = 2; }
        else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
        newLiveCells[newCount++] = nIdx;
      }
    }

    nIdx = ym1Off + xp1;
    if (color[nIdx] === 0 && !checked[nIdx]) {
      checked[nIdx] = 1;
      if (neighborCount[nIdx] === 3) {
        var nn1 = neighbor1Count[nIdx];
        if (nn1 > 1) { newColor[nIdx] = 1; }
        else if (nn1 < 2) { newColor[nIdx] = 2; }
        else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
        newLiveCells[newCount++] = nIdx;
      }
    }

    nIdx = yOff + xm1;
    if (color[nIdx] === 0 && !checked[nIdx]) {
      checked[nIdx] = 1;
      if (neighborCount[nIdx] === 3) {
        var nn1 = neighbor1Count[nIdx];
        if (nn1 > 1) { newColor[nIdx] = 1; }
        else if (nn1 < 2) { newColor[nIdx] = 2; }
        else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
        newLiveCells[newCount++] = nIdx;
      }
    }

    nIdx = yOff + xp1;
    if (color[nIdx] === 0 && !checked[nIdx]) {
      checked[nIdx] = 1;
      if (neighborCount[nIdx] === 3) {
        var nn1 = neighbor1Count[nIdx];
        if (nn1 > 1) { newColor[nIdx] = 1; }
        else if (nn1 < 2) { newColor[nIdx] = 2; }
        else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
        newLiveCells[newCount++] = nIdx;
      }
    }

    nIdx = yp1Off + xm1;
    if (color[nIdx] === 0 && !checked[nIdx]) {
      checked[nIdx] = 1;
      if (neighborCount[nIdx] === 3) {
        var nn1 = neighbor1Count[nIdx];
        if (nn1 > 1) { newColor[nIdx] = 1; }
        else if (nn1 < 2) { newColor[nIdx] = 2; }
        else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
        newLiveCells[newCount++] = nIdx;
      }
    }

    nIdx = yp1Off + x;
    if (color[nIdx] === 0 && !checked[nIdx]) {
      checked[nIdx] = 1;
      if (neighborCount[nIdx] === 3) {
        var nn1 = neighbor1Count[nIdx];
        if (nn1 > 1) { newColor[nIdx] = 1; }
        else if (nn1 < 2) { newColor[nIdx] = 2; }
        else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
        newLiveCells[newCount++] = nIdx;
      }
    }

    nIdx = yp1Off + xp1;
    if (color[nIdx] === 0 && !checked[nIdx]) {
      checked[nIdx] = 1;
      if (neighborCount[nIdx] === 3) {
        var nn1 = neighbor1Count[nIdx];
        if (nn1 > 1) { newColor[nIdx] = 1; }
        else if (nn1 < 2) { newColor[nIdx] = 2; }
        else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
        newLiveCells[newCount++] = nIdx;
      }
    }
  }

  // Phase 3: Clear buffers using fill(0) — fast memset for typed arrays
  neighborCount.fill(0);
  neighbor1Count.fill(0);
  checked.fill(0);
  // Clear old color
  for (var li = 0; li < numLive; li++) {
    color[liveCells[li]] = 0;
  }

  this.color = newColor;
  this.useA = !this.useA;
  this.liveCells = newLiveCells;
  this.newLiveCells = liveCells;
  this.liveCount = newCount;

  return this.getLiveCounts();
};

ToroidalGOL.prototype.getLiveCounts = function () {
  var cols = this.columns;
  var color = this.color;
  var liveCells = this.liveCells;
  var numLive = this.liveCount;

  var livecells1 = 0;
  var livecells2 = 0;
  for (var i = 0; i < numLive; i++) {
    if (color[liveCells[i]] === 1) livecells1++;
    else livecells2++;
  }
  var livecells = livecells1 + livecells2;

  this.livecells = livecells;
  this.livecells1 = livecells1;
  this.livecells2 = livecells2;

  var victory = 0.0;
  if (livecells1 > livecells2) {
    victory = livecells1 / (1.0 * livecells1 + livecells2 + SMOL);
  } else {
    victory = livecells2 / (1.0 * livecells1 + livecells2 + SMOL);
  }
  victory = victory * 100;
  this.victory = victory;

  var totalArea = this.columns * this.rows;
  this.coverage = (livecells / totalArea) * 100;
  this.territory1 = (livecells1 / totalArea) * 100;
  this.territory2 = (livecells2 / totalArea) * 100;

  var r = this._liveCountsResult;
  r.generation = this.generation;
  r.liveCells = livecells;
  r.liveCells1 = livecells1;
  r.liveCells2 = livecells2;
  r.victoryPct = victory;
  r.coverage = this.coverage;
  r.territory1 = this.territory1;
  r.territory2 = this.territory2;
  return r;
};

ToroidalGOL.prototype.nextStep = function () {
  this.generation++;
  var liveCounts = this._nextGenerationLogic();
  this.updateMovingAvg(liveCounts);
  return liveCounts;
};

function runBenchmark(s1, s2, rows, columns, timeLimitS, checkpointCallback) {
  var gol = new ToroidalGOL(s1, s2, rows, columns);

  var lc = gol.getLiveCounts();
  if (!checkpointCallback(0, lc.liveCells1, lc.liveCells2)) {
    return 0;
  }

  var perf = require('perf_hooks').performance;
  var start = perf.now();
  var deadlineMs = timeLimitS * 1000;
  var gen = 0;

  // Phase 1: Run through checkpoint generations
  var checkpointGens = [1, 2, 3, 4, 5, 60, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 5000];
  for (var ci = 0; ci < checkpointGens.length; ci++) {
    var target = checkpointGens[ci];
    while (gen < target) {
      lc = gol.nextStep();
      gen = gol.generation;
    }
    if (!checkpointCallback(gen, lc.liveCells1, lc.liveCells2)) {
      break;
    }
    if ((perf.now() - start) >= deadlineMs) break;
  }

  // Phase 2: No more checkpoints — batch generations
  if (gen >= 5000 && (perf.now() - start) < deadlineMs) {
    while (true) {
      for (var b = 0; b < 128; b++) {
        gol.nextStep();
      }
      gen = gol.generation;
      if ((perf.now() - start) >= deadlineMs) break;
    }
    lc = gol.getLiveCounts();
    checkpointCallback(gen, lc.liveCells1, lc.liveCells2);
  }

  var elapsedS = (perf.now() - start) / 1000;
  var genPerSec = gen / (elapsedS > 0 ? elapsedS : 1);

  console.log('---');
  console.log('total_generations:  ' + gen);
  console.log('total_walltime:     ' + Math.round(elapsedS));
  console.log('generations_per_s:  ' + genPerSec.toFixed(2));

  return gen;
}

module.exports = { runBenchmark };
