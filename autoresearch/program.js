/**
 * program.js - Self-contained two-color toroidal Game of Life simulator.
 *
 * Hybrid: dense Uint8Array grids for O(1) lookup + live cell list for sparse iteration.
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
  // Dense grids for O(1) lookup. grid stores color: 0=dead, 1=team1, 2=team2
  this.color = new Uint8Array(size);
  // Live cell list as packed integers (y * columns + x)
  this.liveCells = [];

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

  for (var ri = 0; ri < s1.length; ri++) {
    var s1row = s1[ri];
    var keys = Object.keys(s1row);
    for (var ki = 0; ki < keys.length; ki++) {
      var y = parseInt(keys[ki], 10);
      var xs = s1row[keys[ki]];
      for (var xi = 0; xi < xs.length; xi++) {
        var idx = y * cols + xs[xi];
        color[idx] = 1;
        liveCells.push(idx);
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
        liveCells.push(idx);
      }
    }
  }

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
  var rows = this.rows;
  var cols = this.columns;
  var color = this.color;
  var liveCells = this.liveCells;
  var rowUp = this.rowUp;
  var rowDown = this.rowDown;
  var colLeft = this.colLeft;
  var colRight = this.colRight;

  // Use Int32Array as a neighbor count map. We track which cells to check.
  // For each live cell, increment neighbor counts for all 8 neighbors.
  var size = rows * cols;
  var neighborCount = new Int32Array(size);
  // Track team1 neighbor counts for color determination
  var neighbor1Count = new Int32Array(size);

  // For each live cell, add to neighbor counts of surrounding cells
  for (var li = 0; li < liveCells.length; li++) {
    var idx = liveCells[li];
    var y = (idx / cols) | 0;
    var x = idx - y * cols;
    var ym1 = rowUp[y];
    var yp1 = rowDown[y];
    var xm1 = colLeft[x];
    var xp1 = colRight[x];

    var ym1Off = ym1 * cols;
    var yOff = y * cols;
    var yp1Off = yp1 * cols;

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

  // Now determine new state. We need to check:
  // 1. All currently live cells (survival: n=2 or n=3)
  // 2. All dead cells with exactly 3 neighbors (birth)
  // To find candidate dead cells efficiently, iterate live cells' neighbors
  var newColor = new Uint8Array(size);
  var newLiveCells = [];

  // Use a marker to avoid processing the same dead cell twice
  var checked = new Uint8Array(size);

  for (var li = 0; li < liveCells.length; li++) {
    var idx = liveCells[li];
    var n = neighborCount[idx];

    // Survival
    if (n === 2 || n === 3) {
      var n1 = neighbor1Count[idx];
      var n2 = n - n1;
      var y = (idx / cols) | 0;
      var x = idx - y * cols;
      if (n1 > n2) {
        newColor[idx] = 1;
      } else if (n2 > n1) {
        newColor[idx] = 2;
      } else if (x % 2 === y % 2) {
        newColor[idx] = 1;
      } else {
        newColor[idx] = 2;
      }
      newLiveCells.push(idx);
    }

    // Check dead neighbors for birth
    var y = (idx / cols) | 0;
    var x = idx - y * cols;
    var ym1 = rowUp[y];
    var yp1 = rowDown[y];
    var xm1 = colLeft[x];
    var xp1 = colRight[x];

    var ym1Off = ym1 * cols;
    var yOff = y * cols;
    var yp1Off = yp1 * cols;

    var neighbors8 = [
      ym1Off + xm1, ym1Off + x, ym1Off + xp1,
      yOff + xm1, yOff + xp1,
      yp1Off + xm1, yp1Off + x, yp1Off + xp1
    ];

    for (var ni = 0; ni < 8; ni++) {
      var nIdx = neighbors8[ni];
      if (color[nIdx] === 0 && !checked[nIdx]) {
        checked[nIdx] = 1;
        if (neighborCount[nIdx] === 3) {
          var nn1 = neighbor1Count[nIdx];
          var nn2 = 3 - nn1;
          var ny = (nIdx / cols) | 0;
          var nx = nIdx - ny * cols;
          if (nn1 > nn2) {
            newColor[nIdx] = 1;
          } else if (nn2 > nn1) {
            newColor[nIdx] = 2;
          } else if (nx % 2 === ny % 2) {
            newColor[nIdx] = 1;
          } else {
            newColor[nIdx] = 2;
          }
          newLiveCells.push(nIdx);
        }
      }
    }
  }

  this.color = newColor;
  this.liveCells = newLiveCells;
  return this.getLiveCounts();
};

ToroidalGOL.prototype.getLiveCounts = function () {
  var rows = this.rows;
  var cols = this.columns;
  var color = this.color;
  var liveCells = this.liveCells;

  var livecells1 = 0;
  var livecells2 = 0;
  for (var i = 0; i < liveCells.length; i++) {
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
  if (!this.running) {
    return this.getLiveCounts();
  } else if (this.foundVictor) {
    this.running = false;
    return this.getLiveCounts();
  } else {
    this.generation++;
    var liveCounts = this._nextGenerationLogic();
    this.updateMovingAvg(liveCounts);
    return liveCounts;
  }
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
  while ((perf.now() - start) < deadlineMs) {
    lc = gol.nextStep();
    gen = gol.generation;
    if (!checkpointCallback(gen, lc.liveCells1, lc.liveCells2)) {
      break;
    }
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
