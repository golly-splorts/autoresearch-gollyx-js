/**
 * program.js - Self-contained two-color toroidal Game of Life simulator.
 *
 * Hybrid: dense Uint8Array grids for O(1) lookup + live cell list for sparse iteration.
 * Pre-allocated buffers, double-buffered color grid, sparse clearing.
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
  this.runningAvgWindow = new Array(this.maxdim).fill(0);
  this.runningAvgLast3 = [0, 0, 0];
  this.foundVictor = false;
  this.whoWon = 0;

  var size = rows * columns;
  // Double-buffered color grids (0=dead, 1=team1, 2=team2)
  this.colorA = new Uint8Array(size);
  this.colorB = new Uint8Array(size);
  this.color = this.colorA;
  this.useA = true;

  // Pre-allocated work buffers
  this.neighborCount = new Int32Array(size);
  this.neighbor1Count = new Int32Array(size);
  this.checked = new Uint8Array(size);

  // Live cell lists (pre-allocate generous capacity)
  this.liveCells = new Int32Array(size);
  this.liveCount = 0;
  this.newLiveCells = new Int32Array(size);

  // Dirty tracking for sparse clear
  this.dirtyList = new Int32Array(size * 2);
  this.dirtyCount = 0;

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
  if (this.generation < maxdim) {
    this.runningAvgWindow[this.generation] = livecounts.victoryPct;
  } else {
    this.runningAvgWindow.shift();
    this.runningAvgWindow.push(livecounts.victoryPct);
    var summ = 0;
    for (var i = 0; i < this.runningAvgWindow.length; i++) {
      summ += this.runningAvgWindow[i];
    }
    var runningAvg = summ / this.runningAvgWindow.length;

    var removed = this.runningAvgLast3[0];
    this.runningAvgLast3 = [this.runningAvgLast3[1], this.runningAvgLast3[2], runningAvg];

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
  var dirtyList = this.dirtyList;
  var dirtyCount = 0;

  // Phase 1: Accumulate neighbor counts (only touch cells near live cells)
  for (var li = 0; li < numLive; li++) {
    var idx = liveCells[li];
    var y = (idx / cols) | 0;
    var x = idx - y * cols;
    var ym1Off = rowUp[y] * cols;
    var yOff = y * cols;
    var yp1Off = rowDown[y] * cols;
    var xm1 = colLeft[x];
    var xp1 = colRight[x];

    var i0 = ym1Off + xm1;
    var i1 = ym1Off + x;
    var i2 = ym1Off + xp1;
    var i3 = yOff + xm1;
    var i4 = yOff + xp1;
    var i5 = yp1Off + xm1;
    var i6 = yp1Off + x;
    var i7 = yp1Off + xp1;

    // Track dirty cells for sparse clear
    if (neighborCount[i0] === 0) dirtyList[dirtyCount++] = i0;
    if (neighborCount[i1] === 0) dirtyList[dirtyCount++] = i1;
    if (neighborCount[i2] === 0) dirtyList[dirtyCount++] = i2;
    if (neighborCount[i3] === 0) dirtyList[dirtyCount++] = i3;
    if (neighborCount[i4] === 0) dirtyList[dirtyCount++] = i4;
    if (neighborCount[i5] === 0) dirtyList[dirtyCount++] = i5;
    if (neighborCount[i6] === 0) dirtyList[dirtyCount++] = i6;
    if (neighborCount[i7] === 0) dirtyList[dirtyCount++] = i7;

    neighborCount[i0]++;
    neighborCount[i1]++;
    neighborCount[i2]++;
    neighborCount[i3]++;
    neighborCount[i4]++;
    neighborCount[i5]++;
    neighborCount[i6]++;
    neighborCount[i7]++;

    if (color[idx] === 1) {
      neighbor1Count[i0]++;
      neighbor1Count[i1]++;
      neighbor1Count[i2]++;
      neighbor1Count[i3]++;
      neighbor1Count[i4]++;
      neighbor1Count[i5]++;
      neighbor1Count[i6]++;
      neighbor1Count[i7]++;
    }
  }

  // Phase 2: Determine new state
  var newColor = this.useA ? this.colorB : this.colorA;
  var newLiveCells = this.newLiveCells;
  var newCount = 0;

  // Check live cells for survival
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

    // Check dead neighbors for birth
    var y = (idx / cols) | 0;
    var x = idx - y * cols;
    var ym1Off = rowUp[y] * cols;
    var yOff = y * cols;
    var yp1Off = rowDown[y] * cols;
    var xm1 = colLeft[x];
    var xp1 = colRight[x];

    var nIdx;

    nIdx = ym1Off + xm1;
    if (color[nIdx] === 0 && !checked[nIdx] && neighborCount[nIdx] === 3) {
      checked[nIdx] = 1;
      var nn1 = neighbor1Count[nIdx];
      if (nn1 > 1) { newColor[nIdx] = 1; }
      else if (nn1 < 2) { newColor[nIdx] = 2; }
      else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
      newLiveCells[newCount++] = nIdx;
    } else if (color[nIdx] === 0) { checked[nIdx] = 1; }

    nIdx = ym1Off + x;
    if (color[nIdx] === 0 && !checked[nIdx] && neighborCount[nIdx] === 3) {
      checked[nIdx] = 1;
      var nn1 = neighbor1Count[nIdx];
      if (nn1 > 1) { newColor[nIdx] = 1; }
      else if (nn1 < 2) { newColor[nIdx] = 2; }
      else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
      newLiveCells[newCount++] = nIdx;
    } else if (color[nIdx] === 0) { checked[nIdx] = 1; }

    nIdx = ym1Off + xp1;
    if (color[nIdx] === 0 && !checked[nIdx] && neighborCount[nIdx] === 3) {
      checked[nIdx] = 1;
      var nn1 = neighbor1Count[nIdx];
      if (nn1 > 1) { newColor[nIdx] = 1; }
      else if (nn1 < 2) { newColor[nIdx] = 2; }
      else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
      newLiveCells[newCount++] = nIdx;
    } else if (color[nIdx] === 0) { checked[nIdx] = 1; }

    nIdx = yOff + xm1;
    if (color[nIdx] === 0 && !checked[nIdx] && neighborCount[nIdx] === 3) {
      checked[nIdx] = 1;
      var nn1 = neighbor1Count[nIdx];
      if (nn1 > 1) { newColor[nIdx] = 1; }
      else if (nn1 < 2) { newColor[nIdx] = 2; }
      else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
      newLiveCells[newCount++] = nIdx;
    } else if (color[nIdx] === 0) { checked[nIdx] = 1; }

    nIdx = yOff + xp1;
    if (color[nIdx] === 0 && !checked[nIdx] && neighborCount[nIdx] === 3) {
      checked[nIdx] = 1;
      var nn1 = neighbor1Count[nIdx];
      if (nn1 > 1) { newColor[nIdx] = 1; }
      else if (nn1 < 2) { newColor[nIdx] = 2; }
      else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
      newLiveCells[newCount++] = nIdx;
    } else if (color[nIdx] === 0) { checked[nIdx] = 1; }

    nIdx = yp1Off + xm1;
    if (color[nIdx] === 0 && !checked[nIdx] && neighborCount[nIdx] === 3) {
      checked[nIdx] = 1;
      var nn1 = neighbor1Count[nIdx];
      if (nn1 > 1) { newColor[nIdx] = 1; }
      else if (nn1 < 2) { newColor[nIdx] = 2; }
      else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
      newLiveCells[newCount++] = nIdx;
    } else if (color[nIdx] === 0) { checked[nIdx] = 1; }

    nIdx = yp1Off + x;
    if (color[nIdx] === 0 && !checked[nIdx] && neighborCount[nIdx] === 3) {
      checked[nIdx] = 1;
      var nn1 = neighbor1Count[nIdx];
      if (nn1 > 1) { newColor[nIdx] = 1; }
      else if (nn1 < 2) { newColor[nIdx] = 2; }
      else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
      newLiveCells[newCount++] = nIdx;
    } else if (color[nIdx] === 0) { checked[nIdx] = 1; }

    nIdx = yp1Off + xp1;
    if (color[nIdx] === 0 && !checked[nIdx] && neighborCount[nIdx] === 3) {
      checked[nIdx] = 1;
      var nn1 = neighbor1Count[nIdx];
      if (nn1 > 1) { newColor[nIdx] = 1; }
      else if (nn1 < 2) { newColor[nIdx] = 2; }
      else { var ny = (nIdx / cols) | 0; newColor[nIdx] = ((nIdx - ny * cols) % 2 === ny % 2) ? 1 : 2; }
      newLiveCells[newCount++] = nIdx;
    } else if (color[nIdx] === 0) { checked[nIdx] = 1; }
  }

  // Phase 3: Sparse clear of work buffers using dirty list
  for (var di = 0; di < dirtyCount; di++) {
    var d = dirtyList[di];
    neighborCount[d] = 0;
    neighbor1Count[d] = 0;
    checked[d] = 0;
  }
  // Also clear entries for live cells themselves (they may have neighbor counts but weren't in dirty list)
  for (var li = 0; li < numLive; li++) {
    var idx = liveCells[li];
    neighborCount[idx] = 0;
    neighbor1Count[idx] = 0;
    checked[idx] = 0;
  }
  // Clear old color for cells that were alive
  for (var li = 0; li < numLive; li++) {
    color[liveCells[li]] = 0;
  }

  this.dirtyCount = 0;
  this.color = newColor;
  this.useA = !this.useA;

  // Swap live cell buffers
  this.liveCells = newLiveCells;
  this.newLiveCells = liveCells;
  this.liveCount = newCount;

  return this.getLiveCounts();
};

ToroidalGOL.prototype.getLiveCounts = function () {
  var rows = this.rows;
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

  var totalArea = cols * rows;
  this.coverage = (livecells / totalArea) * 100;
  this.territory1 = (livecells1 / totalArea) * 100;
  this.territory2 = (livecells2 / totalArea) * 100;

  return {
    generation: this.generation,
    liveCells: livecells,
    liveCells1: livecells1,
    liveCells2: livecells2,
    victoryPct: victory,
    coverage: this.coverage,
    territory1: this.territory1,
    territory2: this.territory2,
    last3: this.runningAvgLast3,
  };
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

  // Phase 1: Run through checkpoint generations one at a time
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

  // Phase 2: No more checkpoints — batch generations, check time every 128 gens
  if (gen >= 5000 && (perf.now() - start) < deadlineMs) {
    while (true) {
      for (var b = 0; b < 128; b++) {
        gol.nextStep();
      }
      gen = gol.generation;
      if ((perf.now() - start) >= deadlineMs) break;
    }
    // Final callback at last gen
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
