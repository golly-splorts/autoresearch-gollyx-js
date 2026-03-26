/**
 * program.js - Self-contained two-color toroidal Game of Life simulator.
 *
 * This is the ONLY file that the autoresearch agent is allowed to modify.
 * It must expose runBenchmark(s1, s2, rows, columns, timeLimitS, checkpointCallback)
 * that runs the simulation until time expires or the callback aborts, and returns
 * the total number of generations completed.
 */

const EQUALTOL = 1e-8;
const SMOL = 1e-12;

function ToroidalGOL(s1, s2, rows, columns) {
  if (typeof s1 === 'string') s1 = JSON.parse(s1);
  if (typeof s2 === 'string') s2 = JSON.parse(s2);

  this.ic1 = s1;
  this.ic2 = s2;
  this.rows = rows;
  this.columns = columns;
  this.ruleB = [3];
  this.ruleS = [2, 3];
  this.maxdim = 280;
  this.running = true;
  this.generation = 0;
  this.runningAvgWindow = new Array(this.maxdim).fill(0);
  this.runningAvgLast3 = [0, 0, 0];
  this.foundVictor = false;
  this.whoWon = 0;
  this.actualState = [];
  this.actualState1 = [];
  this.actualState2 = [];
  this.prepare();
}

ToroidalGOL.prototype.prepare = function () {
  var s1 = this.ic1;
  var s2 = this.ic2;

  for (var ri = 0; ri < s1.length; ri++) {
    var s1row = s1[ri];
    var keys = Object.keys(s1row);
    for (var ki = 0; ki < keys.length; ki++) {
      var y = parseInt(keys[ki], 10);
      var xs = s1row[keys[ki]];
      for (var xi = 0; xi < xs.length; xi++) {
        this.actualState = this.addCell(xs[xi], y, this.actualState);
        this.actualState1 = this.addCell(xs[xi], y, this.actualState1);
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
        this.actualState = this.addCell(xs[xi], y, this.actualState);
        this.actualState2 = this.addCell(xs[xi], y, this.actualState2);
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

ToroidalGOL.prototype.isAlive = function (x, y) {
  x = ((x % this.columns) + this.columns) % this.columns;
  y = ((y % this.rows) + this.rows) % this.rows;

  for (var i = 0; i < this.actualState.length; i++) {
    if (this.actualState[i][0] === y) {
      for (var j = 1; j < this.actualState[i].length; j++) {
        if (this.actualState[i][j] === x) return true;
      }
    }
  }
  return false;
};

ToroidalGOL.prototype.getCellColor = function (x, y) {
  x = ((x % this.columns) + this.columns) % this.columns;
  y = ((y % this.rows) + this.rows) % this.rows;

  for (var i = 0; i < this.actualState1.length; i++) {
    if (this.actualState1[i][0] === y) {
      for (var j = 1; j < this.actualState1[i].length; j++) {
        if (this.actualState1[i][j] === x) return 1;
      }
    } else if (this.actualState1[i][0] > y) {
      break;
    }
  }

  for (var i = 0; i < this.actualState2.length; i++) {
    if (this.actualState2[i][0] === y) {
      for (var j = 1; j < this.actualState2[i].length; j++) {
        if (this.actualState2[i][j] === x) return 2;
      }
    } else if (this.actualState2[i][0] > y) {
      break;
    }
  }
  return 0;
};

ToroidalGOL.prototype.removeCell = function (x, y, state) {
  x = ((x % this.columns) + this.columns) % this.columns;
  y = ((y % this.rows) + this.rows) % this.rows;

  for (var i = 0; i < state.length; i++) {
    if (state[i][0] === y) {
      if (state[i].length === 2) {
        state.splice(i, 1);
        return;
      } else {
        for (var j = 1; j < state[i].length; j++) {
          if (state[i][j] === x) {
            state[i].splice(j, 1);
            return;
          }
        }
      }
    }
  }
};

ToroidalGOL.prototype.addCell = function (x, y, state) {
  x = ((x % this.columns) + this.columns) % this.columns;
  y = ((y % this.rows) + this.rows) % this.rows;

  if (state.length === 0) {
    return [[y, x]];
  }

  if (y < state[0][0]) {
    return [[y, x]].concat(state);
  } else if (y > state[state.length - 1][0]) {
    state.push([y, x]);
    return state;
  } else {
    var newState = [];
    var added = false;
    for (var n = 0; n < state.length; n++) {
      if (!added && state[n][0] === y) {
        var tempRow = [y];
        for (var m = 1; m < state[n].length; m++) {
          if (!added && x < state[n][m]) {
            tempRow.push(x);
            added = true;
          }
          tempRow.push(state[n][m]);
        }
        if (!added) {
          tempRow.push(x);
          added = true;
        }
        newState.push(tempRow);
      } else if (!added && y < state[n][0]) {
        newState.push([y, x]);
        added = true;
        newState.push(state[n]);
      } else {
        newState.push(state[n]);
      }
    }
    return newState;
  }
};

ToroidalGOL.prototype.getNeighborsFromAlive = function (x, y, i, state, possibleNeighborsList) {
  var neighbors = 0;
  var neighbors1 = 0;
  var neighbors2 = 0;
  var cols = this.columns;
  var rows = this.rows;

  x = ((x % cols) + cols) % cols;
  y = ((y % rows) + rows) % rows;
  var xm1 = ((x - 1) + cols) % cols;
  var ym1 = ((y - 1) + rows) % rows;
  var xp1 = (x + 1) % cols;
  var yp1 = (y + 1) % rows;

  var im1 = i - 1;
  if (im1 < 0) im1 = state.length - 1;
  if (im1 < state.length) {
    if (state[im1][0] === ym1) {
      for (var k = 1; k < state[im1].length; k++) {
        if (state[im1][k] === xm1) {
          possibleNeighborsList[0] = null;
          neighbors++;
          var nc = this.getCellColor(state[im1][k], state[im1][0]);
          if (nc === 1) neighbors1++;
          else if (nc === 2) neighbors2++;
        }
        if (state[im1][k] === x) {
          possibleNeighborsList[1] = null;
          neighbors++;
          var nc = this.getCellColor(state[im1][k], state[im1][0]);
          if (nc === 1) neighbors1++;
          else if (nc === 2) neighbors2++;
        }
        if (state[im1][k] === xp1) {
          possibleNeighborsList[2] = null;
          neighbors++;
          var nc = this.getCellColor(state[im1][k], state[im1][0]);
          if (nc === 1) neighbors1++;
          else if (nc === 2) neighbors2++;
        }
      }
    }
  }

  for (var k = 1; k < state[i].length; k++) {
    if (state[i][k] === xm1) {
      possibleNeighborsList[3] = null;
      neighbors++;
      var nc = this.getCellColor(state[i][k], state[i][0]);
      if (nc === 1) neighbors1++;
      else if (nc === 2) neighbors2++;
    }
    if (state[i][k] === xp1) {
      possibleNeighborsList[4] = null;
      neighbors++;
      var nc = this.getCellColor(state[i][k], state[i][0]);
      if (nc === 1) neighbors1++;
      else if (nc === 2) neighbors2++;
    }
  }

  var ip1 = i + 1;
  if (ip1 >= state.length) ip1 = 0;
  if (ip1 < state.length) {
    if (state[ip1][0] === yp1) {
      for (var k = 1; k < state[ip1].length; k++) {
        if (state[ip1][k] === xm1) {
          possibleNeighborsList[5] = null;
          neighbors++;
          var nc = this.getCellColor(state[ip1][k], state[ip1][0]);
          if (nc === 1) neighbors1++;
          else if (nc === 2) neighbors2++;
        }
        if (state[ip1][k] === x) {
          possibleNeighborsList[6] = null;
          neighbors++;
          var nc = this.getCellColor(state[ip1][k], state[ip1][0]);
          if (nc === 1) neighbors1++;
          else if (nc === 2) neighbors2++;
        }
        if (state[ip1][k] === xp1) {
          possibleNeighborsList[7] = null;
          neighbors++;
          var nc = this.getCellColor(state[ip1][k], state[ip1][0]);
          if (nc === 1) neighbors1++;
          else if (nc === 2) neighbors2++;
        }
      }
    }
  }

  var color = 0;
  if (neighbors1 > neighbors2) {
    color = 1;
  } else if (neighbors2 > neighbors1) {
    color = 2;
  } else if (x % 2 === y % 2) {
    color = 1;
  } else {
    color = 2;
  }
  return { neighbors: neighbors, color: color };
};

ToroidalGOL.prototype.getColorFromAlive = function (x, y) {
  var state1 = this.actualState1;
  var state2 = this.actualState2;
  var color1 = 0;
  var color2 = 0;
  var cols = this.columns;
  var rows = this.rows;

  x = ((x % cols) + cols) % cols;
  y = ((y % rows) + rows) % rows;
  var xm1 = ((x - 1) + cols) % cols;
  var ym1 = ((y - 1) + rows) % rows;
  var xp1 = (x + 1) % cols;
  var yp1 = (y + 1) % rows;

  for (var i = 0; i < state1.length; i++) {
    var yy = state1[i][0];
    if (yy === ym1) {
      for (var j = 1; j < state1[i].length; j++) {
        var xx = state1[i][j];
        if (xx === xm1 || xx === x || xx === xp1) color1++;
      }
    } else if (yy === y) {
      for (var j = 1; j < state1[i].length; j++) {
        var xx = state1[i][j];
        if (xx === xm1 || xx === xp1) color1++;
      }
    } else if (yy === yp1) {
      for (var j = 1; j < state1[i].length; j++) {
        var xx = state1[i][j];
        if (xx === xm1 || xx === x || xx === xp1) color1++;
      }
    }
  }

  for (var i = 0; i < state2.length; i++) {
    var yy = state2[i][0];
    if (yy === ym1) {
      for (var j = 1; j < state2[i].length; j++) {
        var xx = state2[i][j];
        if (xx === xm1 || xx === x || xx === xp1) color2++;
      }
    } else if (yy === y) {
      for (var j = 1; j < state2[i].length; j++) {
        var xx = state2[i][j];
        if (xx === xm1 || xx === xp1) color2++;
      }
    } else if (yy === yp1) {
      for (var j = 1; j < state2[i].length; j++) {
        var xx = state2[i][j];
        if (xx === xm1 || xx === x || xx === xp1) color2++;
      }
    }
  }

  if (color1 > color2) return 1;
  if (color1 < color2) return 2;
  if (x % 2 === y % 2) return 1;
  return 2;
};

ToroidalGOL.prototype._nextGenerationLogic = function () {
  var allDeadNeighbors = {};
  var newState = [];
  var newState1 = [];
  var newState2 = [];

  for (var i = 0; i < this.actualState.length; i++) {
    for (var j = 1; j < this.actualState[i].length; j++) {
      var x = this.actualState[i][j];
      var y = this.actualState[i][0];
      var cols = this.columns;
      var rows = this.rows;

      x = ((x % cols) + cols) % cols;
      y = ((y % rows) + rows) % rows;
      var xm1 = ((x - 1) + cols) % cols;
      var ym1 = ((y - 1) + rows) % rows;
      var xp1 = (x + 1) % cols;
      var yp1 = (y + 1) % rows;

      var deadNeighbors = [
        [xm1, ym1, 1], [x, ym1, 1], [xp1, ym1, 1],
        [xm1, y, 1],                [xp1, y, 1],
        [xm1, yp1, 1], [x, yp1, 1], [xp1, yp1, 1],
      ];

      var result = this.getNeighborsFromAlive(x, y, i, this.actualState, deadNeighbors);
      var neighbors = result.neighbors;
      var color = result.color;

      for (var m = 0; m < 8; m++) {
        if (deadNeighbors[m] !== null) {
          var xx = deadNeighbors[m][0];
          var yy = deadNeighbors[m][1];
          var key = xx + ',' + yy;
          if (allDeadNeighbors[key] === undefined) {
            allDeadNeighbors[key] = 1;
          } else {
            allDeadNeighbors[key]++;
          }
        }
      }

      if (neighbors === 2 || neighbors === 3) {
        newState = this.addCell(x, y, newState);
        if (color === 1) {
          newState1 = this.addCell(x, y, newState1);
        } else if (color === 2) {
          newState2 = this.addCell(x, y, newState2);
        }
      }
    }
  }

  var keys = Object.keys(allDeadNeighbors);
  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    if (allDeadNeighbors[key] === 3) {
      var parts = key.split(',');
      var t1 = parseInt(parts[0], 10);
      var t2 = parseInt(parts[1], 10);
      var color = this.getColorFromAlive(t1, t2);
      newState = this.addCell(t1, t2, newState);
      if (color === 1) {
        newState1 = this.addCell(t1, t2, newState1);
      } else if (color === 2) {
        newState2 = this.addCell(t1, t2, newState2);
      }
    }
  }

  this.actualState = newState;
  this.actualState1 = newState1;
  this.actualState2 = newState2;
  return this.getLiveCounts();
};

ToroidalGOL.prototype.getLiveCounts = function () {
  var rows = this.rows;
  var cols = this.columns;

  function countLiveCells(state) {
    var livecells = 0;
    for (var i = 0; i < state.length; i++) {
      if (state[i][0] >= 0 && state[i][0] < rows) {
        for (var j = 1; j < state[i].length; j++) {
          if (state[i][j] >= 0 && state[i][j] < cols) {
            livecells++;
          }
        }
      }
    }
    return livecells;
  }

  var livecells = countLiveCells(this.actualState);
  var livecells1 = countLiveCells(this.actualState1);
  var livecells2 = countLiveCells(this.actualState2);

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
