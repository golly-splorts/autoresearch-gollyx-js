/**
 * bench.js - Benchmark harness for autoresearch optimization of ToroidalGOL.
 *
 * This file is IMMUTABLE. The autoresearch agent must NOT modify it.
 *
 * Runs the (possibly modified) program.js for a fixed wall-clock duration,
 * validates correctness at checkpoints via callback, and reports throughput
 * in generations per second.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// ---------------------------------------------------------------------------
// Test case: 150x240 grid, "Domino Party" map
// San Francisco Boat Shoes vs Fargo Flea Flickers
// Season 4, Day 3 — game a99d9b78-62f1-4e02-929a-5ee0a84f9770
// Teams interact starting around generation 60.
// ---------------------------------------------------------------------------

const S1 = '[{"68":[74,75]},{"69":[13,14,48,75,76,111,112]},{"70":[12,13,22,47,48,75,110,111]},{"71":[13,21,22,48,49,101,102,111]},{"72":[22,23,38,39,102,103]},{"73":[39,40,66,102]},{"74":[39,65,66]},{"75":[66,67]},{"76":[30,31]},{"77":[29,30,85,86,94]},{"78":[30,58,84,85,94,95]},{"79":[57,58,85,93,94]},{"80":[58,59]}]';
const S2 = '[{"70":[138]},{"71":[137,138]},{"72":[129,130,138,139,191,192,208,209]},{"73":[128,129,164,165,181,182,190,191,201,209,210,228]},{"74":[129,165,166,173,174,182,183,191,200,201,209,227,228]},{"75":[146,147,156,165,172,173,182,201,202,228,229]},{"76":[147,148,155,156,173]},{"77":[147,156,157,218]},{"78":[217,218]},{"79":[218,219]}]';
const ROWS = 150;
const COLUMNS = 240;
const TIME_LIMIT_S = 180; // 3 minutes

// Gold-standard checkpoint data: {generation: [team1_livecells, team2_livecells]}
// Dense at start (catch basic GoL errors fast), sparse later.
const CHECKPOINTS = {
  0: [60, 60],
  1: [72, 72],
  2: [84, 84],
  3: [108, 108],
  4: [96, 96],
  5: [108, 108],
  60: [301, 365],
  100: [291, 428],
  200: [175, 391],
  300: [125, 514],
  400: [120, 461],
  500: [120, 497],
  600: [150, 507],
  700: [196, 495],
  800: [127, 587],
  900: [120, 594],
  1000: [120, 440],
  2000: [93, 967],
  3000: [92, 1130],
  5000: [259, 921],
};

const CHECKPOINT_GENERATIONS = Object.keys(CHECKPOINTS).map(Number).sort((a, b) => a - b);

const RESULTS_FILE = path.join(__dirname, 'results.tsv');

function runAndValidate() {
  const { runBenchmark } = require('./program.js');

  var failure = null;

  function checkpointCallback(generation, c1, c2) {
    if (CHECKPOINTS[generation] !== undefined) {
      var expected = CHECKPOINTS[generation];
      var expectedC1 = expected[0];
      var expectedC2 = expected[1];
      if (c1 !== expectedC1 || c2 !== expectedC2) {
        failure = {
          gen: generation,
          expected: [expectedC1, expectedC2],
          actual: [c1, c2],
        };
        console.log('\n!! CHECKPOINT MISMATCH at generation ' + generation + ' !!');
        console.log('   expected: team1=' + expectedC1 + ', team2=' + expectedC2);
        console.log('   actual:   team1=' + c1 + ', team2=' + c2);
        var delta1 = c1 - expectedC1;
        var delta2 = c2 - expectedC2;
        console.log('   delta:    team1=' + (delta1 >= 0 ? '+' : '') + delta1 + ', team2=' + (delta2 >= 0 ? '+' : '') + delta2);
        if (generation > 0) {
          var prevGens = CHECKPOINT_GENERATIONS.filter(function (g) { return g < generation; });
          if (prevGens.length > 0) {
            var lastOk = prevGens[prevGens.length - 1];
            console.log('   last OK checkpoint: generation ' + lastOk);
            console.log('   error emerged in generation range (' + lastOk + ', ' + generation + ']');
          }
        }
        return false;
      }
    }
    return true;
  }

  var start = performance.now();
  var generations = runBenchmark(S1, S2, ROWS, COLUMNS, TIME_LIMIT_S, checkpointCallback);
  var elapsed = (performance.now() - start) / 1000;

  var genPerSec = elapsed > 0 ? generations / elapsed : 0.0;

  if (failure) {
    return {
      wall_time_s: elapsed,
      generations: generations,
      gen_per_sec: genPerSec,
      correct: false,
      failed_at: failure.gen,
      expected: failure.expected,
      actual: failure.actual,
    };
  }

  return {
    wall_time_s: elapsed,
    generations: generations,
    gen_per_sec: genPerSec,
    correct: true,
    failed_at: null,
    expected: null,
    actual: null,
  };
}

function appendResult(result, notes) {
  notes = notes || '';
  var header = 'timestamp\tgenerations\tgen_per_sec\twall_time_s\tcorrect\tfailed_at\tnotes\n';
  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, header);
  }

  var now = new Date();
  var ts = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0');

  var line = ts + '\t' + result.generations + '\t' + result.gen_per_sec.toFixed(2) + '\t' +
    result.wall_time_s.toFixed(4) + '\t' + result.correct + '\t' +
    result.failed_at + '\t' + notes + '\n';
  fs.appendFileSync(RESULTS_FILE, line);
}

function main() {
  console.log('Running benchmark for ' + TIME_LIMIT_S + 's...');
  var result = runAndValidate();

  if (result.correct) {
    console.log('PASS  ' + result.generations + ' generations in ' + result.wall_time_s.toFixed(2) + 's');
    console.log('      ' + result.gen_per_sec.toFixed(2) + ' generations/sec');
  } else {
    console.log('FAIL  at generation ' + result.failed_at);
    console.log('  expected: [' + result.expected + ']');
    console.log('  actual:   [' + result.actual + ']');
    console.log('  (' + result.generations + ' generations in ' + result.wall_time_s.toFixed(2) + 's)');
  }

  var notes = process.argv.slice(2).join(' ');
  appendResult(result, notes);
}

main();
