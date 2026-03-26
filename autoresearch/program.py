"""
program.py - Self-contained two-color toroidal Game of Life simulator.

This is the ONLY file that the autoresearch agent is allowed to modify.
It must expose run_benchmark(s1, s2, rows, columns, time_limit_s, checkpoint_callback)
that runs the simulation until time expires or the callback aborts, and returns
the total number of generations completed.
"""

from operator import indexOf
import math
import json
import time

EQUALTOL = 1e-8
SMOL = 1e-12


class ToroidalGOL(object):
    ...
    def __init__(
        self,
        s1,
        s2,
        rows: int,
        columns: int,
        rule_b: list = None,
        rule_s: list = None,
        maxdim: int = 280,
        halt: bool = True,
        periodic: bool = True,
        b1: list = [],
        b2: list = [],
        c1: list = [],
        c2: list = [],
    ):
        if isinstance(s1, str):
            s1 = json.loads(s1)
        if isinstance(s2, str):
            s2 = json.loads(s2)

        self.ic1 = s1
        self.ic2 = s2
        self.rows = rows
        self.columns = columns
        self.rule_b = rule_b or [3]
        self.rule_s = rule_s or [2, 3]
        self.maxdim = maxdim
        self.halt = halt
        self.periodic = periodic
        self.running = True
        self.generation = 0
        self.running_avg_window = [0,]*self.maxdim
        self.running_avg_last3 = [0, 0, 0]
        self.found_victor = False
        self.actual_state = []
        self.actual_state1 = []
        self.actual_state2 = []
        self.prepare()

    def get_live_cells(self):
        live1 = []
        for row in self.actual_state1:
            y = row[0]
            for x in row[1:]:
                live1.append((x, y))
        live2 = []
        for row in self.actual_state2:
            y = row[0]
            for x in row[1:]:
                live2.append((x, y))
        return live1, live2

    def prepare(self):
        s1 = self.ic1
        s2 = self.ic2

        for s1row in s1:
            for y in s1row:
                yy = int(y)
                for xx in s1row[y]:
                    self.actual_state = self.add_cell(xx, yy, self.actual_state)
                    self.actual_state1 = self.add_cell(xx, yy, self.actual_state1)

        for s2row in s2:
            for y in s2row:
                yy = int(y)
                for xx in s2row[y]:
                    self.actual_state = self.add_cell(xx, yy, self.actual_state)
                    self.actual_state2 = self.add_cell(xx, yy, self.actual_state2)

        livecounts = self.get_live_counts()
        self.update_moving_avg(livecounts)

    def update_moving_avg(self, livecounts):
        if not self.found_victor:
            maxdim = self.maxdim
            if self.generation < maxdim:
                self.running_avg_window[self.generation] = livecounts["victoryPct"]
            else:
                self.running_avg_window = self.running_avg_window[1:] + [
                    livecounts["victoryPct"]
                ]
                summ = sum(self.running_avg_window)
                running_avg = summ / (1.0 * len(self.running_avg_window))

                removed = self.running_avg_last3[0]
                self.running_avg_last3 = self.running_avg_last3[1:] + [running_avg]

                tol = EQUALTOL
                if not self.approx_equal(removed, 0.0, tol):
                    b1 = self.approx_equal(
                        self.running_avg_last3[0], self.running_avg_last3[1], tol
                    )
                    b2 = self.approx_equal(
                        self.running_avg_last3[1], self.running_avg_last3[2], tol
                    )
                    zerocells = (
                        livecounts["liveCells1"] == 0 or livecounts["liveCells2"] == 0
                    )
                    if (b1 and b2) or zerocells:
                        z1 = self.approx_equal(self.running_avg_last3[0], 50.0, tol)
                        z2 = self.approx_equal(self.running_avg_last3[1], 50.0, tol)
                        z3 = self.approx_equal(self.running_avg_last3[2], 50.0, tol)
                        if (not (z1 or z2 or z3)) or zerocells:
                            if livecounts["liveCells1"] > livecounts["liveCells2"]:
                                self.found_victor = True
                                self.who_won = 1
                            elif livecounts["liveCells1"] < livecounts["liveCells2"]:
                                self.found_victor = True
                                self.who_won = 2

    def approx_equal(self, a, b, tol):
        denom = max(abs(a), abs(b), SMOL)
        return (abs(a - b) / denom) < tol

    def is_alive(self, x, y):
        if self.periodic:
            x = (x + self.columns)%(self.columns)
            y = (y + self.rows)%(self.rows)

        for row in self.actual_state:
            if row[0] == y:
                for c in row[1:]:
                    if c == x:
                        return True
        return False

    def get_cell_color(self, x, y):
        if self.periodic:
            x = (x + self.columns)%(self.columns)
            y = (y + self.rows)%(self.rows)

        for row in self.actual_state1:
            if row[0] == y:
                for c in row[1:]:
                    if c == x:
                        return 1
            elif row[0] > y:
                break

        for row in self.actual_state2:
            if row[0] == y:
                for c in row[1:]:
                    if c == x:
                        return 2
            elif row[0] > y:
                break
        return 0

    def remove_cell(self, x, y, state):
        if self.periodic:
            x = (x + self.columns)%(self.columns)
            y = (y + self.rows)%(self.rows)

        for i, row in enumerate(state):
            if row[0] == y:
                if len(row) == 2:
                    state = state[:i] + state[i + 1 :]
                    return
                else:
                    j = indexOf(row, x)
                    state[i] = row[:j] + row[j + 1 :]

    def add_cell(self, x, y, state):
        if self.periodic:
            x = (x + self.columns)%(self.columns)
            y = (y + self.rows)%(self.rows)

        if len(state) == 0:
            return [[y, x]]

        if y < state[0][0]:
            return [[y, x]] + state

        elif y > state[-1][0]:
            return state + [[y, x]]

        else:
            new_state = []
            added = False
            for row in state:
                if (not added) and (row[0] == y):
                    new_row = [y]
                    for c in row[1:]:
                        if (not added) and (x < c):
                            new_row.append(x)
                            added = True
                        new_row.append(c)
                    if not added:
                        new_row.append(x)
                        added = True
                    new_state.append(new_row)
                elif (not added) and (y < row[0]):
                    new_row = [y, x]
                    new_state.append(new_row)
                    added = True
                    new_state.append(row)
                else:
                    new_state.append(row)

            if added is False:
                raise Exception(f"Error adding cell ({x},{y}): new_state = {new_state}")

            return new_state

    def get_neighbors_from_alive(self, x, y, i, state, possible_neighbors_list):
        neighbors = 0
        neighbors1 = 0
        neighbors2 = 0

        xm1 = x - 1
        ym1 = y - 1
        xp1 = x + 1
        yp1 = y + 1

        periodic = self.periodic
        if periodic:
            x = (x + self.columns)%(self.columns)
            y = (y + self.rows)%(self.rows)
            xm1 = ((x-1) + self.columns)%(self.columns)
            ym1 = ((y-1) + self.rows)%(self.rows)
            xp1 = ((x+1) + self.columns)%(self.columns)
            yp1 = ((y+1) + self.rows)%(self.rows)

        im1 = i-1
        if im1 < 0:
            im1 = len(state)-1
        if im1 < len(state):
            if state[im1][0] == ym1:
                for k in range(1, len(state[im1])):
                    if state[im1][k] >= xm1 or periodic:
                        if state[im1][k] == xm1:
                            possible_neighbors_list[0] = None
                            neighbors += 1
                            neighborcolor = self.get_cell_color(state[im1][k], state[im1][0])
                            if neighborcolor == 1:
                                neighbors1 += 1
                            elif neighborcolor == 2:
                                neighbors2 += 1
                        if state[im1][k] == x:
                            possible_neighbors_list[1] = None
                            neighbors += 1
                            neighborcolor = self.get_cell_color(state[im1][k], state[im1][0])
                            if neighborcolor == 1:
                                neighbors1 += 1
                            elif neighborcolor == 2:
                                neighbors2 += 1
                        if state[im1][k] == xp1:
                            possible_neighbors_list[2] = None
                            neighbors += 1
                            neighborcolor = self.get_cell_color(state[im1][k], state[im1][0])
                            if neighborcolor == 1:
                                neighbors1 += 1
                            elif neighborcolor == 2:
                                neighbors2 += 1
                        if not periodic and state[im1][k] > xp1:
                            break

        for k in range(1, len(state[i])):
            if state[i][k] >= xm1 or periodic:
                if state[i][k] == xm1:
                    possible_neighbors_list[3] = None
                    neighbors += 1
                    neighborcolor = self.get_cell_color(state[i][k], state[i][0])
                    if neighborcolor == 1:
                        neighbors1 += 1
                    elif neighborcolor == 2:
                        neighbors2 += 1
                if state[i][k] == xp1:
                    possible_neighbors_list[4] = None
                    neighbors += 1
                    neighborcolor = self.get_cell_color(state[i][k], state[i][0])
                    if neighborcolor == 1:
                        neighbors1 += 1
                    elif neighborcolor == 2:
                        neighbors2 += 1
                if not periodic and state[i][k] > xp1:
                    break

        ip1 = i+1
        if ip1 >= len(state):
            ip1 = 0
        if ip1 < len(state):
            if state[ip1][0] == yp1:
                for k in range(1, len(state[ip1])):
                    if state[ip1][k] >= xm1 or periodic:
                        if state[ip1][k] == xm1:
                            possible_neighbors_list[5] = None
                            neighbors += 1
                            neighborcolor = self.get_cell_color(state[ip1][k], state[ip1][0])
                            if neighborcolor == 1:
                                neighbors1 += 1
                            elif neighborcolor == 2:
                                neighbors2 += 1
                        if state[ip1][k] == x:
                            possible_neighbors_list[6] = None
                            neighbors += 1
                            neighborcolor = self.get_cell_color(state[ip1][k], state[ip1][0])
                            if neighborcolor == 1:
                                neighbors1 += 1
                            elif neighborcolor == 2:
                                neighbors2 += 1
                        if state[ip1][k] == xp1:
                            possible_neighbors_list[7] = None
                            neighbors += 1
                            neighborcolor = self.get_cell_color(state[ip1][k], state[ip1][0])
                            if neighborcolor == 1:
                                neighbors1 += 1
                            elif neighborcolor == 2:
                                neighbors2 += 1
                        if not periodic and state[ip1][k] > xp1:
                            break
        color = 0
        if neighbors1 > neighbors2:
            color = 1
        elif neighbors2 > neighbors1:
            color = 2
        elif x % 2 == y % 2:
            color = 1
        else:
            color = 2
        return dict(neighbors=neighbors, color=color)

    def get_color_from_alive(self, x, y):
        state1 = self.actual_state1
        state2 = self.actual_state2
        color1 = 0
        color2 = 0
        xm1 = x - 1
        ym1 = y - 1
        xp1 = x + 1
        yp1 = y + 1

        periodic = self.periodic
        if periodic:
            x = (x + self.columns)%(self.columns)
            y = (y + self.rows)%(self.rows)
            xm1 = ((x-1) + self.columns)%(self.columns)
            ym1 = ((y-1) + self.rows)%(self.rows)
            xp1 = ((x+1) + self.columns)%(self.columns)
            yp1 = ((y+1) + self.rows)%(self.rows)

        for i in range(len(state1)):
            yy = state1[i][0]
            if yy == ym1:
                for j in range(1, len(state1[i])):
                    xx = state1[i][j]
                    if xx >= xm1 or periodic:
                        if xx == xm1:
                            color1 += 1
                        elif xx == x:
                            color1 += 1
                        elif xx == xp1:
                            color1 += 1
                    if not periodic and xx >= xp1:
                        break
            elif yy == y:
                for j in range(1, len(state1[i])):
                    xx = state1[i][j]
                    if xx >= xm1 or periodic:
                        if xx == xm1:
                            color1 += 1
                        elif xx == xp1:
                            color1 += 1
                    if not periodic and xx >= xp1:
                        break
            elif yy == yp1:
                for j in range(1, len(state1[i])):
                    xx = state1[i][j]
                    if xx >= xm1 or periodic:
                        if xx == xm1:
                            color1 += 1
                        elif xx == x:
                            color1 += 1
                        elif xx == xp1:
                            color1 += 1
                    if not periodic and xx >= xp1:
                        break

        for i in range(len(state2)):
            yy = state2[i][0]
            if yy == ym1:
                for j in range(1, len(state2[i])):
                    xx = state2[i][j]
                    if xx >= xm1 or periodic:
                        if xx == xm1:
                            color2 += 1
                        elif xx == x:
                            color2 += 1
                        elif xx == xp1:
                            color2 += 1
                    if not periodic and xx >= xp1:
                        break
            elif yy == y:
                for j in range(1, len(state2[i])):
                    xx = state2[i][j]
                    if xx >= xm1 or periodic:
                        if xx == xm1:
                            color2 += 1
                        elif xx == xp1:
                            color2 += 1
                    if not periodic and xx >= xp1:
                        break
            elif yy == yp1:
                for j in range(1, len(state2[i])):
                    xx = state2[i][j]
                    if xx >= xm1 or periodic:
                        if xx == xm1:
                            color2 += 1
                        elif xx == x:
                            color2 += 1
                        elif xx == xp1:
                            color2 += 1
                    if not periodic and xx >= xp1:
                        break

        if color1 > color2:
            return 1
        elif color1 < color2:
            return 2
        elif x % 2 == y % 2:
            color = 1
        else:
            color = 2
        return color

    def _next_generation_logic(self):
        all_dead_neighbors = {}
        new_state = []
        new_state1 = []
        new_state2 = []
        self.redraw_list = []

        for i in range(len(self.actual_state)):
            self.top_pointer = 1
            self.bottom_pointer = 1
            for j in range(1, len(self.actual_state[i])):
                x = self.actual_state[i][j]
                y = self.actual_state[i][0]
                xm1 = x - 1
                ym1 = y - 1
                xp1 = x + 1
                yp1 = y + 1

                if self.periodic:
                    x = (x + self.columns)%(self.columns)
                    y = (y + self.rows)%(self.rows)
                    xm1 = ((x-1) + self.columns)%(self.columns)
                    ym1 = ((y-1) + self.rows)%(self.rows)
                    xp1 = ((x+1) + self.columns)%(self.columns)
                    yp1 = ((y+1) + self.rows)%(self.rows)

                dead_neighbors = [
                    [xm1, ym1, 1], [x,   ym1, 1], [xp1, ym1, 1],
                    [xm1, y,   1], [xp1, y,   1],
                    [xm1, yp1, 1], [x,   yp1, 1], [xp1, yp1, 1],
                ]

                result = self.get_neighbors_from_alive(
                    x, y, i, self.actual_state, dead_neighbors
                )
                neighbors = result["neighbors"]
                color = result["color"]

                for dead_neighbor in dead_neighbors:
                    if dead_neighbor is not None:
                        xx = dead_neighbor[0]
                        yy = dead_neighbor[1]
                        key = str(xx) + "," + str(yy)
                        if key not in all_dead_neighbors:
                            all_dead_neighbors[key] = 1
                        else:
                            all_dead_neighbors[key] += 1

                if neighbors in self.rule_s:
                    new_state = self.add_cell(x, y, new_state)
                    if color == 1:
                        new_state1 = self.add_cell(x, y, new_state1)
                    elif color == 2:
                        new_state2 = self.add_cell(x, y, new_state2)
                    self.redraw_list.append([x, y, 2])
                else:
                    self.redraw_list.append([x, y, 0])

        for key in all_dead_neighbors:
            if all_dead_neighbors[key] in self.rule_b:
                key = key.split(",")
                t1 = int(key[0])
                t2 = int(key[1])
                color = self.get_color_from_alive(t1, t2)
                new_state = self.add_cell(t1, t2, new_state)
                if color == 1:
                    new_state1 = self.add_cell(t1, t2, new_state1)
                elif color == 2:
                    new_state2 = self.add_cell(t1, t2, new_state2)
                self.redraw_list.append([t1, t2, 1])

        self.actual_state = new_state
        self.actual_state1 = new_state1
        self.actual_state2 = new_state2
        return self.get_live_counts()

    def get_live_counts(self):
        def _count_live_cells(state):
            livecells = 0
            for i in range(len(state)):
                if (state[i][0] >= 0) and (state[i][0] < self.rows):
                    for j in range(1, len(state[i])):
                        if (state[i][j] >= 0) and (state[i][j] < self.columns):
                            livecells += 1
            return livecells

        livecells = _count_live_cells(self.actual_state)
        livecells1 = _count_live_cells(self.actual_state1)
        livecells2 = _count_live_cells(self.actual_state2)

        self.livecells = livecells
        self.livecells1 = livecells1
        self.livecells2 = livecells2

        victory = 0.0
        if livecells1 > livecells2:
            victory = livecells1 / (1.0 * livecells1 + livecells2 + SMOL)
        else:
            victory = livecells2 / (1.0 * livecells1 + livecells2 + SMOL)
        victory = victory * 100
        self.victory = victory

        total_area = self.columns * self.rows
        coverage = livecells / (1.0 * total_area)
        coverage = coverage * 100
        self.coverage = coverage

        territory1 = livecells1 / (1.0 * total_area)
        territory1 = territory1 * 100
        territory2 = livecells2 / (1.0 * total_area)
        territory2 = territory2 * 100
        self.territory1 = territory1
        self.territory2 = territory2

        return dict(
            generation=self.generation,
            liveCells=livecells,
            liveCells1=livecells1,
            liveCells2=livecells2,
            victoryPct=victory,
            coverage=coverage,
            territory1=territory1,
            territory2=territory2,
            last3=self.running_avg_last3,
        )

    def next_step(self):
        if self.running is False:
            return self.get_live_counts()
        elif self.halt and self.found_victor:
            self.running = False
            return self.get_live_counts()
        else:
            self.generation += 1
            live_counts = self._next_generation_logic()
            self.update_moving_avg(live_counts)
            return live_counts


def run_benchmark(s1, s2, rows, columns, time_limit_s, checkpoint_callback):
    """
    Run a ToroidalGOL simulation until time expires or the callback aborts.

    Args:
        s1: JSON string of team 1 initial conditions
        s2: JSON string of team 2 initial conditions
        rows: Grid rows
        columns: Grid columns
        time_limit_s: Maximum wall-clock seconds to run
        checkpoint_callback: callable(generation, c1, c2) -> bool
            Called every generation. Return True to continue, False to abort.

    Returns:
        int: total number of generations completed
    """
    gol = ToroidalGOL(s1=s1, s2=s2, rows=rows, columns=columns, periodic=True)

    lc = gol.get_live_counts()
    if not checkpoint_callback(0, lc["liveCells1"], lc["liveCells2"]):
        return 0

    start = time.perf_counter()
    deadline = start + time_limit_s
    gen = 0
    while time.perf_counter() < deadline:
        lc = gol.next_step()
        gen = gol.generation
        if not checkpoint_callback(gen, lc["liveCells1"], lc["liveCells2"]):
            break

    elapsed = time.perf_counter() - start
    gen_per_sec = gen / elapsed if elapsed > 0 else 0.0

    print("---")
    print(f"total_generations:  {gen}")
    print(f"total_walltime:     {elapsed:.0f}")
    print(f"generations_per_s:  {gen_per_sec:.2f}")

    return gen
