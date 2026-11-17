// Global Undo-only memory accounting for immutable drawing geometry.
// Persistent 32-way trees share untouched branches so an append never walks old points.
// Current ink and the nearest complete Undo/Redo are protected; inactive pages must unload.
const { strokeAppend } = require("./stroke-signature.js");
const { DrawingResourceLedger } = require("./drawing-resource-ledger.js");
const WIDTH = 32, ENTRY_BYTES = 96;
const decodedGeometry = new WeakMap();
const freshStrokes = new WeakSet();
let geometrySequence = 0;
const certifyFreshStroke = stroke => { freshStrokes.add(stroke); return stroke; };
async function prepareFreshStroke(source, prepare) {
  const next = await prepare(source);
  if (next === source || !freshStrokes.has(source)) return next;
  if (!next || !Array.isArray(next.points) || next.points === source.points || next.points.length !== source.points.length || next.colorHex !== source.colorHex || !Object.is(next.width, source.width) || next.pressures !== source.pressures) {
    freshStrokes.delete(source); throw TypeError('Prepared drawing stroke changed its owned geometry contract.');
  }
  freshStrokes.delete(source); freshStrokes.add(next); return next;
}
const clock = () => globalThis.performance?.now() ?? Date.now();
const yieldTask = () => new Promise(resolve => {
  if (typeof setImmediate === 'function') setImmediate(resolve);
  else if (typeof MessageChannel === 'function') {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  } else if (typeof setTimeout === 'function') setTimeout(resolve, 0);
  else Promise.resolve().then(resolve);
});
class DrawingHistoryBudget {
  constructor({ maxBytes = 128 * 1024 * 1024, maxStates = 100 } = {}) {
    this.maxBytes = maxBytes;
    this.maxStates = maxStates;
    this.ownExtra = 0;
    this.ownTotal = 0;
    this.geometry = new DrawingResourceLedger();
    this.entryBytes = 0;
    this.entries = /* @__PURE__ */ new Map();
    this.owners = /* @__PURE__ */ new Set();
    this.resources = /* @__PURE__ */ new WeakMap();
    this.states = /* @__PURE__ */ new WeakMap();
    this.aggregateLeaves = new Set();
    this.aggregateEpoch = 0;
    this.lastUncertified = 0;
    this.visits = 0;
    this.pendingPreparations = 0;
    this.releaseQueue = [];
    this.finalizer = typeof FinalizationRegistry === "function" ? new FinalizationRegistry((record) => this.scheduleRelease(record)) : null;
  }
  get extra() { return this.ownExtra + this.geometry.extra; }
  get total() { return this.ownTotal + this.geometry.total; }
  resource(key, bytes) {
    let value = this.resources.get(key);
    if (!value) {
      value = { bytes, current: 0, history: 0 };
      this.resources.set(key, value);
    }
    return value;
  }
  adjust(value, kind, delta) {
    const charged = value.history > 0 && !value.current, used = value.current + value.history > 0;
    value[kind] += delta;
    if (value[kind] < 0) throw Error("Invalid drawing history ownership.");
    const next = value.history > 0 && !value.current, now = value.current + value.history > 0;
    if (charged !== next) this.ownExtra += next ? value.bytes : -value.bytes;
    if (used !== now) this.ownTotal += now ? value.bytes : -value.bytes;
  }
  prime(stroke) {
    freshStrokes.delete(stroke);
    if (!stroke || !Array.isArray(stroke.points) || stroke.pressures != null && !Array.isArray(stroke.pressures)) throw TypeError("Invalid immutable drawing stroke.");
    // Leaves retain the immutable source identities themselves. Accounting is
    // acquired only while a tree is held, so decode needs no per-stroke graph.
    return stroke;
  }
  node(children, level, certified = false, epoch = this.aggregateEpoch) {
    let count = 0, pointCount = 0, estimatedBytes = 64 + children.length * 8;
    for (const child of children) {
      count += level ? child.count : 1;
      pointCount += level ? child.pointCount : child.points.length;
      estimatedBytes += level ? child.estimatedBytes : 160 + child.points.length * 64 + (child.pressures ? 32 + child.pressures.length * 8 : 0);
    }
    const resources = [{ bytes: 64 + children.length * 8, current: 0, history: 0 }], aggregate = !level && certified ? {bytes: estimatedBytes - resources[0].bytes, current: 0, history: 0} : null;
    if (aggregate) resources.push(aggregate);
    return { current: 0, history: 0, children, level, count, pointCount, estimatedBytes, resources, aggregate, aggregateEpoch: epoch };
  }
  canAggregate(array) { return (decodedGeometry.get(array) || 0) > this.lastUncertified; }
  materializeLeaf(node) {
    const aggregate = node.aggregate;
    if (!aggregate) return;
    for (const kind of ['current', 'history']) if (node[kind] > 0) {
      for (const stroke of node.children) this.holdStroke(stroke, kind, 1);
      this.adjust(aggregate, kind, -1);
    }
    node.resources.pop(); node.aggregate = null;
    this.aggregateLeaves.delete(node);
  }
  invalidateAggregates() {
    this.lastUncertified = ++geometrySequence; this.aggregateEpoch++;
    for (const node of this.aggregateLeaves) this.materializeLeaf(node);
  }
  async invalidateAggregatesAsync(pause) {
    this.lastUncertified = ++geometrySequence; this.aggregateEpoch++;
    let start = clock();
    for (const node of this.aggregateLeaves) {
      if (node.aggregateEpoch !== this.aggregateEpoch) this.materializeLeaf(node);
      if (clock() - start >= 3) { await pause(); start = clock(); }
    }
  }
  build(array, certified = false) {
    if (!array.length) return null;
    let nodes = [];
    for (let i = 0; i < array.length; i += WIDTH) nodes.push(this.node(array.slice(i, i + WIDTH).map((stroke) => this.prime(stroke)), 0, certified));
    let level = 0;
    while (nodes.length > 1) {
      const next = [];
      for (let i = 0; i < nodes.length; i += WIDTH) next.push(this.node(nodes.slice(i, i + WIDTH), level + 1));
      nodes = next;
      level++;
    }
    return nodes[0];
  }
  push(node, token) {
    if (!node) return { node: this.node([token], 0), overflow: null };
    if (!node.level) { this.materializeLeaf(node); return node.children.length < WIDTH ? { node: this.node([...node.children, token], 0), overflow: null } : { node, overflow: this.node([token], 0) }; }
    const children = node.children.slice(), last = this.push(children.at(-1), token);
    children[children.length - 1] = last.node;
    if (!last.overflow) return { node: this.node(children, node.level), overflow: null };
    if (children.length < WIDTH) return { node: this.node([...children, last.overflow], node.level), overflow: null };
    return { node: this.node(children, node.level), overflow: this.node([last.overflow], node.level) };
  }
  remove(node, index) {
    if (!node || index < 0 || index >= node.count) return node;
    if (!node.level) this.materializeLeaf(node);
    const children = node.children.slice();
    if (!node.level) children.splice(index, 1);
    else {
      let at = 0;
      while (index >= children[at].count) index -= children[at++].count;
      const next = this.remove(children[at], index);
      if (next) children[at] = next;
      else children.splice(at, 1);
    }
    return children.length ? this.node(children, node.level) : null;
  }
  state(array) {
    if (!Array.isArray(array)) throw TypeError("Drawing history requires an immutable stroke array.");
    let state = this.states.get(array);
    if (state) return state;
    const link = strokeAppend(array), base = link && this.states.get(link.previous);
    const certified = this.canAggregate(array);
    const append = base && array.length === base.array.length + 1 && array.at(-1) === link.stroke;
    const freshAppend = append && freshStrokes.delete(link.stroke);
    if (array.length && !certified && !freshAppend) this.invalidateAggregates();
    let tree;
    if (append) {
      const next = this.push(base.tree, this.prime(link.stroke));
      tree = next.overflow ? this.node([next.node, next.overflow], next.node.level + 1) : next.node;
    } else tree = this.build(array, certified);
    state = { array, tree, current: 0, history: 0, memory: this.resource(array, 32 + array.length * 8) };
    this.states.set(array, state);
    return state;
  }
  async stateAsync(array, pause = yieldTask) {
    if (!Array.isArray(array)) throw TypeError('Drawing history requires an immutable stroke array.');
    if (this.states.has(array) || array.length < 4096 || strokeAppend(array)) return this.state(array);
    const certified = this.canAggregate(array);
    if (!certified) await this.invalidateAggregatesAsync(pause);
    const epoch = this.aggregateEpoch;
    let nodes = [], start = clock();
    for (let i = 0; i < array.length; i += WIDTH) {
      nodes.push(this.node(array.slice(i, i + WIDTH).map(stroke => this.prime(stroke)), 0, certified, epoch));
      if (clock() - start >= 3) { await pause(); start = clock(); }
    }
    let level = 0;
    while (nodes.length > 1) {
      const next = [];
      for (let i = 0; i < nodes.length; i += WIDTH) {
        next.push(this.node(nodes.slice(i, i + WIDTH), level + 1));
        if (clock() - start >= 3) { await pause(); start = clock(); }
      }
      nodes = next; level++;
    }
    if (this.states.has(array)) return this.states.get(array);
    const state = {array, tree: nodes[0] || null, current: 0, history: 0, memory: this.resource(array, 32 + array.length * 8)};
    this.states.set(array, state);
    return state;
  }
  prepareRemoval(previous, next, index) {
    const base = this.state(previous);
    if (next.length === previous.length - 1 && Number.isInteger(index) && index >= 0 && index < previous.length) this.states.set(next, { array: next, tree: this.remove(base.tree, index), current: 0, history: 0, memory: this.resource(next, 32 + next.length * 8) });
  }
  holdNode(node, kind, delta) {
    if (!node) return;
    if (node.aggregate && node.aggregateEpoch !== this.aggregateEpoch) this.materializeLeaf(node);
    this.visits++;
    const before = node[kind] > 0;
    node[kind] += delta;
    if (node[kind] < 0) throw Error("Invalid drawing tree ownership.");
    if (before === node[kind] > 0) return;
    for (const resource of node.resources) this.adjust(resource, kind, delta > 0 ? 1 : -1);
    if (node.aggregate) { if (node.current || node.history) this.aggregateLeaves.add(node); else this.aggregateLeaves.delete(node); }
    else if (node.level) for (const child of node.children) this.holdNode(child, kind, delta > 0 ? 1 : -1);
    else for (const stroke of node.children) this.holdStroke(stroke, kind, delta > 0 ? 1 : -1);
  }
  holdStroke(stroke, kind, delta) {
    this.visits++;
    this.geometry.adjust(stroke, 128, kind, delta);
    this.geometry.adjust(stroke.points, 32 + stroke.points.length * 64, kind, delta);
    if (stroke.pressures) this.geometry.adjust(stroke.pressures, 32 + stroke.pressures.length * 8, kind, delta);
  }
  hold(state, kind, delta) {
    const before = state[kind] > 0;
    state[kind] += delta;
    if (state[kind] < 0) throw Error("Invalid drawing snapshot ownership.");
    if (before === state[kind] > 0) return;
    this.adjust(state.memory, kind, delta > 0 ? 1 : -1);
    this.holdNode(state.tree, kind, delta > 0 ? 1 : -1);
  }
  async holdAsync(state, kind, delta, pause = yieldTask) {
    const before = state[kind] > 0;
    state[kind] += delta;
    if (state[kind] < 0) throw Error('Invalid drawing snapshot ownership.');
    if (before === (state[kind] > 0)) return;
    const change = delta > 0 ? 1 : -1;
    this.adjust(state.memory, kind, change);
    const stack = state.tree ? [state.tree] : [];
    let start = clock(), work = 0;
    while (stack.length) {
      const node = stack.pop();
      if (node.aggregate && node.aggregateEpoch !== this.aggregateEpoch) this.materializeLeaf(node);
      const held = node[kind] > 0;
      this.visits++; node[kind] += change;
      if (node[kind] < 0) throw Error('Invalid drawing tree ownership.');
      if (held !== (node[kind] > 0)) {
        for (const resource of node.resources) this.adjust(resource, kind, change);
        if (node.aggregate) { if (node.current || node.history) this.aggregateLeaves.add(node); else this.aggregateLeaves.delete(node); }
        else if (node.level) for (const child of node.children) stack.push(child);
        else for (const stroke of node.children) this.holdStroke(stroke, kind, change);
      }
      work += node.level ? 1 : node.children.length + 1;
      if (work >= 128 && clock() - start >= 3) { await pause(); start = clock(); work = 0; }
    }
  }
  register(owner, array) {
    this.prune();
    const record = { owner: new WeakRef(owner), current: this.state(array), past: [], future: [], pastView: null, futureView: null, released: false };
    this.hold(record.current, "current", 1);
    // A standby history hold makes the first pen stroke after a large hydration
    // as cheap as later appends; it never exposes an Undo frame or charges current ink.
    this.hold(record.current, "history", 1);
    this.owners.add(record);
    this.finalizer?.register(owner, record, record);
    return record;
  }
  drop(record, list, entry) {
    const values = record[list], index = values.indexOf(entry);
    if (index < 0) return;
    values.splice(index, 1);
    record[list + "View"] = null;
    this.entries.delete(entry);
    this.entryBytes -= ENTRY_BYTES;
    this.hold(entry.state, "history", -1);
  }
  clear(record, list) {
    for (const entry of [...record[list]]) this.drop(record, list, entry);
  }
  add(record, list, state, enforceLimit = true) {
    const entry = { record, list, state };
    record[list].push(entry);
    record[list + "View"] = null;
    this.entries.set(entry, entry);
    this.entryBytes += ENTRY_BYTES;
    this.hold(state, "history", 1);
    while (enforceLimit && record.past.length + record.future.length > this.maxStates) {
      const candidates = [record.past[0], record.future[0]].filter((value) => value && record[value.list].length > 1);
      const old = [...this.entries.keys()].find((value) => candidates.includes(value));
      if (!old) break;
      this.drop(record, old.list, old);
    }
    return entry;
  }
  setCurrent(record, state) {
    if (record.current === state) return;
    this.hold(state, "current", 1);
    this.hold(state, "history", 1);
    const old = record.current;
    record.current = state;
    if (old) { this.hold(old, "current", -1); this.hold(old, "history", -1); }
  }
  trim() {
    if (this.pendingPreparations) return;
    if (this.extra + this.entryBytes <= this.maxBytes) return;
    for (const entry of this.entries.keys()) {
      if (this.extra + this.entryBytes <= this.maxBytes) break;
      const record = entry.record;
      if (record.past.at(-1) === entry || record.future.at(-1) === entry) continue;
      this.drop(record, entry.list, entry);
    }
  }
  async trimAsync(pause = yieldTask) {
    if (this.pendingPreparations) return;
    if (this.trimming) return this.trimming;
    this.trimming = (async () => {
      for (const entry of this.entries.keys()) {
        if (this.pendingPreparations || this.extra + this.entryBytes <= this.maxBytes) break;
        const record = entry.record;
        if (record.past.at(-1) === entry || record.future.at(-1) === entry) continue;
        const values = record[entry.list], index = values.indexOf(entry);
        if (index < 0) continue;
        values.splice(index, 1); record[entry.list + 'View'] = null;
        this.entries.delete(entry); this.entryBytes -= ENTRY_BYTES;
        await this.holdAsync(entry.state, 'history', -1, pause);
      }
    })();
    try { await this.trimming; } finally { this.trimming = null; }
  }
  release(record) {
    if (!record || record.released) return;
    record.released = true;
    this.clear(record, "past");
    this.clear(record, "future");
    if (record.current) { this.hold(record.current, "current", -1); this.hold(record.current, "history", -1); }
    record.current = null;
    this.owners.delete(record);
    this.finalizer?.unregister(record);
  }
  async releaseAsync(record, pause = yieldTask) {
    if (!record || record.released) return;
    record.released = true;
    const entries = [...record.past, ...record.future], current = record.current;
    record.past = []; record.future = []; record.pastView = null; record.futureView = null; record.current = null;
    this.owners.delete(record); this.finalizer?.unregister(record);
    for (const entry of entries) { this.entries.delete(entry); this.entryBytes -= ENTRY_BYTES; }
    this.pendingPreparations++;
    try {
      for (const entry of entries) await this.holdAsync(entry.state, 'history', -1, pause);
      if (current) { await this.holdAsync(current, 'current', -1, pause); await this.holdAsync(current, 'history', -1, pause); }
    } finally {
      this.pendingPreparations--;
      await this.trimAsync(pause);
    }
  }
  scheduleRelease(record) {
    if (record.released || record.releaseScheduled) return;
    record.releaseScheduled = true; this.releaseQueue.push(record);
    if (this.releasing) return;
    this.releasing = (async () => {
      await yieldTask();
      while (this.releaseQueue.length) { await this.releaseAsync(this.releaseQueue.shift()); await yieldTask(); }
    })().finally(() => { this.releasing = null; });
  }
  prune() {
    for (const record of this.owners) if (!record.owner.deref()) this.scheduleRelease(record);
  }
  stats() {
    this.prune();
    return { extraBytes: this.extra + this.entryBytes, resourceBytes: this.total, protectedBytes: this.total - this.extra, frames: this.entries.size, owners: this.owners.size, nodeVisits: this.visits, maxBytes: this.maxBytes };
  }
}
const sharedBudget = new DrawingHistoryBudget();
class DrawingHistory {
  constructor(array = [], { budget = sharedBudget } = {}) {
    this.budget = budget;
    this.array = array;
    this.record = budget.register(this, array);
    this.revision = 0;
  }
  ensure() {
    if (!this.record || this.record.released) this.record = this.budget.register(this, this.array);
    return this.record;
  }
  get current() {
    return this.array;
  }
  get currentGeometryPoints() {
    return this.record && !this.record.released ? this.record.current?.tree?.pointCount || 0 : 0;
  }
  get canUndo() {
    return !!this.record?.past.length;
  }
  get canRedo() {
    return !!this.record?.future.length;
  }
  get retainedGeometryPoints() {
    const record = this.record;
    if (!record || record.released) return 0;
    // Conservative upper bound: shared points in these three complete scenes
    // may be counted more than once. Cache budgeting never walks their strokes.
    return (record.current?.tree?.pointCount || 0) + (record.past.at(-1)?.state.tree?.pointCount || 0) + (record.future.at(-1)?.state.tree?.pointCount || 0);
  }
  get retainedGeometryBytes() {
    const record=this.record;
    if(!record||record.released)return 0;
    const states=[record.current,record.past.at(-1)?.state,record.future.at(-1)?.state];
    return states.reduce((bytes,state)=>bytes+(state?(state.tree?.estimatedBytes||0)+state.memory.bytes:0),0);
  }
  setCurrent(array) {
    this.revision++;
    const record = this.ensure();
    this.budget.setCurrent(record, this.budget.state(array));
    this.array = array;
    this.budget.trim();
  }
  mark() {
    this.revision++;
    const record = this.ensure();
    this.budget.clear(record, "future");
    this.budget.add(record, "past", record.current);
    this.budget.trim();
  }
  step(redo = false) {
    const record = this.ensure(), from = redo ? "future" : "past", to = redo ? "past" : "future", entry = record[from].at(-1);
    if (!entry) return null;
    const previous = record.current;
    this.revision++;
    // Keep shared history branches held while transferring a frame between stacks.
    this.budget.add(record, to, previous, false);
    this.budget.setCurrent(record, entry.state);
    this.array = entry.state.array;
    this.budget.drop(record, from, entry);
    this.budget.trim();
    return this.array;
  }
  peek(redo = false) { return this.record?.[redo ? 'future' : 'past'].at(-1)?.state.array || null; }
  async change(array, action, {signal, valid = () => true, yieldControl = yieldTask} = {}) {
    const record = this.ensure(), original = this.array, previous = record.current, revision = this.revision;
    let pauseError = null;
    const pause = async () => { try { await yieldControl(); } catch (error) { pauseError = error; await yieldTask(); } };
    const current = () => !pauseError && !signal?.aborted && valid() && this.record === record && !record.released && this.array === original && this.revision === revision;
    if (!current()) return false;
    const state = await this.budget.stateAsync(array, pause);
    if (pauseError) throw pauseError;
    if (!current()) return false;
    const pins = [], budget = this.budget;
    budget.pendingPreparations++;
    try {
      // Pin existing roots before preparation. The eventual visible commit only changes
      // root reference counts; large ownership walks happen in ordinary yielding tasks.
      for (const entry of budget.entries.keys()) { budget.hold(entry.state, 'history', 1); pins.push([entry.state, 'history']); }
      budget.hold(previous, 'current', 1); pins.push([previous, 'current']);
      if (array.length >= 4096 || original.length >= 4096) await pause();
      if (pauseError) throw pauseError;
      if (!current()) return false;
      await budget.holdAsync(previous, 'history', 1, pause); pins.push([previous, 'history']);
      await budget.holdAsync(state, 'current', 1, pause); pins.push([state, 'current']);
      await budget.holdAsync(state, 'history', 1, pause); pins.push([state, 'history']);
      if (pauseError) throw pauseError;
      if (!current()) return false;
      action();
      return true;
    } finally {
      for (const [held, kind] of pins.reverse()) await budget.holdAsync(held, kind, -1, pause);
      budget.pendingPreparations--;
      await budget.trimAsync(pause);
    }
  }
  prepareRemoval(next, index) {
    this.budget.prepareRemoval(this.array, next, index);
  }
  export() {
    const record = this.ensure();
    return { strokes: this.array, past: record.pastView || (record.pastView = record.past.map((entry) => entry.state.array)), future: record.futureView || (record.futureView = record.future.map((entry) => entry.state.array)) };
  }
  import({ strokes, past = [], future = [] }) {
    this.revision++;
    const current = this.budget.state(strokes), before = past.slice(-this.budget.maxStates).map((array) => this.budget.state(array)), after = future.slice(-this.budget.maxStates).map((array) => this.budget.state(array));
    this.dispose();
    this.array = strokes;
    const record = this.ensure();
    this.budget.setCurrent(record, current);
    for (const state of before) this.budget.add(record, "past", state);
    for (const state of after) this.budget.add(record, "future", state);
    this.budget.trim();
  }
  clear() {
    this.revision++;
    const record = this.ensure();
    this.budget.clear(record, "past");
    this.budget.clear(record, "future");
    this.budget.trim();
  }
  dispose() {
    this.revision++;
    this.budget.release(this.record);
    this.record = null;
    this.array = [];
  }
  async disposeAsync() {
    this.revision++;
    const record = this.record;
    this.record = null; this.array = [];
    await this.budget.releaseAsync(record);
  }
}
globalThis.NoteMindDrawingHistory = { primeStroke: (stroke) => sharedBudget.prime(stroke), primeDecodedArray: array => decodedGeometry.set(array, ++geometrySequence) };
module.exports = { DrawingHistoryBudget, DrawingHistory, sharedBudget, certifyFreshStroke, prepareFreshStroke };
