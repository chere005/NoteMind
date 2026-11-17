// Persistent numeric occurrence order. Borrowed leaf views are read-only.
// Resolver/cost semantics stay constant within viewKey; new snapshots pass their own resolver.
// Async input views remain immutable until the operation settles.
const { yieldTask } = require("./graphics-pane.js");
const LEAF = 256, FANOUT = 32, MAX_LENGTH = 2e6, MAX_LOCATOR = 513 * 2000001, MAX_REFS = 1e6;
const EMPTY = { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity };
const abort = () => Object.assign(Error("Ink order cancelled."), { name: "AbortError" });
const now = () => globalThis.performance?.now() ?? Date.now();
class Pacer {
  constructor({ signal, yieldControl = yieldTask } = {}) {
    this.signal = signal;
    this.yieldControl = yieldControl;
    if (typeof yieldControl !== "function") throw Error("Invalid ink yield function.");
    this.work = 0;
    this.time = now();
    this.check();
  }
  check() {
    if (this.signal?.aborted) throw abort();
  }
  poll(n = 1) {
    this.work += n;
    return this.work >= 4096 || this.work % 256 === 0 && now() - this.time >= 3;
  }
  async pause() {
    this.check();
    await this.yieldControl();
    this.check();
    this.work = 0;
    this.time = now();
  }
}
const validLocator = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_LOCATOR;
function includeBounds(out, value) {
  if (value && value.x === Infinity && value.y === Infinity && value.right === -Infinity && value.bottom === -Infinity) return;
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.right) || !Number.isFinite(value.bottom) || value.x > value.right || value.y > value.bottom) {
    out.x = out.y = -Infinity;
    out.right = out.bottom = Infinity;
    return;
  }
  extend(out, value);
}
const isLocators = (value) => ArrayBuffer.isView(value) && (["[object Float64Array]", "[object Uint32Array]"].includes(Object.prototype.toString.call(value)));
const empty = (box) => box.x === Infinity;
const finite = (box) => empty(box) || [box.x, box.y, box.right, box.bottom].every(Number.isFinite);
function extend(out, box) {
  if (empty(box)) return;
  out.x = Math.min(out.x, box.x);
  out.y = Math.min(out.y, box.y);
  out.right = Math.max(out.right, box.right);
  out.bottom = Math.max(out.bottom, box.bottom);
}
const touches = (box, rect) => !empty(box) && box.x <= rect.x + rect.width && box.right >= rect.x && box.y <= rect.y + rect.height && box.bottom >= rect.y;
function leaf(values, context2) {
  const box = { ...EMPTY };
  for (const value of values) {
    if (!validLocator(value)) throw Error("Invalid ink locator.");
    includeBounds(box, context2.boundsOf(value));
  }
  const raw = empty(box) ? 0 : finite(box) ? context2.costOfBounds(box) : Infinity, cost = Number.isSafeInteger(raw) && raw >= 0 ? raw : Infinity, node = { height: 0, values, count: values.length, typedBytes: values.byteLength, box, cost, indexed: false, indexRefs: 0, overflow: values.length, leaves: 1, nodes: 1 };
  context2.leafBuilds++;
  context2.created.add(node);
  return node;
}
function branch(children, context2) {
  if (!children.length) return null;
  if (children.length > FANOUT || !children.every((child) => child.height === children[0].height)) throw Error("Invalid ink order branch.");
  const box = { ...EMPTY }, prefix = new Uint32Array(children.length);
  let count = 0, indexRefs = 0, overflow = 0, leaves = 0, nodes = 1, typedBytes = prefix.byteLength;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    extend(box, child.box);
    prefix[i] = count += child.count;
    indexRefs += child.indexRefs;
    overflow += child.overflow;
    leaves += child.leaves;
    nodes += child.nodes;
    typedBytes += child.typedBytes;
  }
  const node = { height: children[0].height + 1, children, prefix, count, box, indexRefs, overflow, leaves, nodes, typedBytes };
  context2.created.add(node);
  return node;
}
function context(options, old) {
  const viewKey = options.viewKey !== void 0 ? options.viewKey : old?.viewKey ?? null;
  if (viewKey !== null && (typeof viewKey !== "string" && typeof viewKey !== "number" || typeof viewKey === "string" && viewKey.length > 4096 || typeof viewKey === "number" && !Number.isFinite(viewKey))) throw Error("Invalid ink view identity.");
  const boundsOf = options.boundsOf || old?.boundsOf, costOfBounds = options.costOfBounds || old?.costOfBounds || (() => 1), maxIndexRefs = options.maxIndexRefs ?? old?.maxIndexRefs ?? MAX_REFS;
  if (typeof boundsOf !== "function" || typeof costOfBounds !== "function" || !Number.isSafeInteger(maxIndexRefs) || maxIndexRefs < 0 || maxIndexRefs > MAX_REFS) throw Error("Invalid ink order index.");
  return { boundsOf, costOfBounds, maxIndexRefs, viewKey, created: /* @__PURE__ */ new Set(), leafBuilds: 0, pacer: new Pacer(options) };
}
function collapse(node) {
  while (node?.height && node.children.length === 1) node = node.children[0];
  return node;
}
function split(node, index, ctx) {
  if (!node) return [null, null];
  if (index === 0) return [null, node];
  if (index === node.count) return [node, null];
  if (!node.height) return [leaf(node.values.slice(0, index), ctx), leaf(node.values.slice(index), ctx)];
  let at = 0, prior = 0;
  while (index > node.prefix[at]) prior = node.prefix[at++];
  const [left, right] = split(node.children[at], index - prior, ctx);
  return [branch([...node.children.slice(0, at), ...left ? [left] : []], ctx), branch([...right ? [right] : [], ...node.children.slice(at + 1)], ctx)];
}
function groups(children, ctx) {
  if (children.length <= FANOUT) return [branch(children, ctx)];
  const middle = Math.ceil(children.length / 2);
  return [branch(children.slice(0, middle), ctx), branch(children.slice(middle), ctx)];
}
function join(left, right, ctx) {
  if (!left) return right ? [right] : [];
  if (!right) return [left];
  if (left.height === right.height) {
    if (!left.height) {
      if (left.count >= LEAF / 2 && right.count >= LEAF / 2 && left.count + right.count > LEAF) return [left, right];
      const ArrayType = left.values instanceof Float64Array || right.values instanceof Float64Array ? Float64Array : Uint32Array;
      const values = new ArrayType(left.count + right.count);
      values.set(left.values);
      values.set(right.values, left.count);
      if (values.length <= LEAF) return [leaf(values, ctx)];
      const middle = Math.ceil(values.length / 2);
      return [leaf(values.slice(0, middle), ctx), leaf(values.slice(middle), ctx)];
    }
    const boundary = join(left.children.at(-1), right.children[0], ctx);
    return groups([...left.children.slice(0, -1), ...boundary, ...right.children.slice(1)], ctx);
  }
  if (left.height > right.height) {
    const tail = join(left.children.at(-1), right, ctx);
    return groups([...left.children.slice(0, -1), ...tail], ctx);
  }
  const head = join(left, right.children[0], ctx);
  return groups([...head, ...right.children.slice(1)], ctx);
}
function concat(left, right, ctx) {
  const nodes = join(collapse(left), collapse(right), ctx);
  return collapse(nodes.length === 1 ? nodes[0] : branch(nodes, ctx));
}
async function buildRoot(values, ctx) {
  if (!isLocators(values) || values.length > MAX_LENGTH) throw Error("Invalid ink order.");
  let level = [];
  for (let at = 0; at < values.length; at += LEAF) {
    const count = Math.min(LEAF, values.length - at);let signedZero = false;
    // Validate original values before narrowing; coercion must never hide invalid input.
    for (let index = 0; index < count; index++) {const value = values[at + index];if (!validLocator(value)) throw Error("Invalid ink locator.");signedZero ||= Object.is(value, -0);}
    // Real locators fit Uint32. Preserve the old observable -0 edge for generic callers.
    const copy = signedZero ? new Float64Array(count) : new Uint32Array(count);
    copy.set(values.subarray(at, at + count));
    level.push(leaf(copy, ctx));
    if (ctx.pacer.poll(copy.length)) await ctx.pacer.pause();
  }
  while (level.length > 1) {
    const next = [];
    for (let at = 0; at < level.length; at += FANOUT) {
      next.push(branch(level.slice(at, at + FANOUT), ctx));
      if (ctx.pacer.poll(FANOUT)) await ctx.pacer.pause();
    }
    level = next;
  }
  return level[0] || null;
}
async function indexCreated(root, ctx) {
  let remaining = ctx.maxIndexRefs - (root?.indexRefs || 0);
  if (remaining < 0) throw Error("Ink index needs reindexing for its new budget.");
  const visit = async (node) => {
    if (!ctx.created.has(node)) return node;
    if (!node.height) {
      const indexed = finite(node.box) && node.cost <= remaining;
      if (indexed) remaining -= node.cost;
      if (ctx.pacer.poll(node.count)) await ctx.pacer.pause();
      return { ...node, indexed, indexRefs: indexed ? node.cost : 0, overflow: indexed ? 0 : node.count };
    }
    const children = [];
    for (const child of node.children) children.push(await visit(child));
    return branch(children, ctx);
  };
  const result = root ? await visit(root) : null;
  ctx.pacer.check();
  return result;
}
function rectOf(rect) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0) throw Error("Invalid ink query area.");
  return rect;
}
class PersistentInkOrder {
  constructor(root, ctx) {
    this.root = root;
    this.boundsOf = ctx.boundsOf;
    this.costOfBounds = ctx.costOfBounds;
    this.maxIndexRefs = ctx.maxIndexRefs;
    this.viewKey = ctx.viewKey;
    this.length = root?.count || 0;
    this.stats = Object.freeze({ indexRefs: root?.indexRefs || 0, overflow: root?.overflow || 0, leaves: root?.leaves || 0, nodes: root?.nodes || 0, typedBytes: root?.typedBytes || 0, createdNodes: ctx.created.size, rebuiltLeaves: ctx.leafBuilds });
  }
  static async build(values, options = {}) {
    const ctx = context(options), root = await buildRoot(values, ctx);
    return new PersistentInkOrder(await indexCreated(root, ctx), ctx);
  }
  at(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return -1;
    let node = this.root;
    while (node.height) {
      let child = 0, prior = 0;
      while (index >= node.prefix[child]) prior = node.prefix[child++];
      index -= prior;
      node = node.children[child];
    }
    return node.values[index];
  }
  async splice(index, deleteCount, insertLocators = new Float64Array(0), options = {}) {
    if (!Number.isInteger(index) || index < 0 || index > this.length || !Number.isInteger(deleteCount) || deleteCount < 0 || deleteCount > this.length - index || !isLocators(insertLocators) || this.length - deleteCount + insertLocators.length > MAX_LENGTH) throw Error("Invalid ink order splice.");
    const ctx = context(options, this);
    if (ctx.viewKey !== this.viewKey || ctx.maxIndexRefs !== this.maxIndexRefs) throw Error("Reindex ink before changing its view or index budget.");
    if (!deleteCount && !insertLocators.length) {
      ctx.pacer.check();
      return this;
    }
    const [left, tail] = split(this.root, index, ctx), [, right] = split(tail, deleteCount, ctx), middle = await buildRoot(insertLocators, ctx), root = concat(concat(left, middle, ctx), right, ctx);
    return new PersistentInkOrder(await indexCreated(root, ctx), ctx);
  }
  async reindex(boundsOf, viewKey, options = {}) {
    if (boundsOf && typeof boundsOf === "object") {
      options = boundsOf;
      boundsOf = options.boundsOf;
      viewKey = options.viewKey;
    }
    const ctx = context({ ...options, boundsOf, viewKey }, this);
    const visit = async (node) => {
      if (!node.height) {
        const copy = leaf(node.values, ctx);
        if (ctx.pacer.poll(node.count)) await ctx.pacer.pause();
        return copy;
      }
      const children = [];
      for (const child of node.children) children.push(await visit(child));
      return branch(children, ctx);
    };
    const root = this.root ? await visit(this.root) : null;
    return new PersistentInkOrder(await indexCreated(root, ctx), ctx);
  }
  *leafEntries(rect) {
    if (rect !== undefined) rectOf(rect);
    function* visit(node, start) {
      if (rect !== undefined && !node.overflow && !touches(node.box, rect)) return;
      if (!node.height) {
        if (rect === undefined || !node.indexed || touches(node.box, rect)) yield { values: node.values, start };
        return;
      }
      for (let index = 0; index < node.children.length; index++) yield* visit(node.children[index], start + (index ? node.prefix[index - 1] : 0));
    }
    if (this.root) yield* visit(this.root, 0);
  }
  *allLeaves() {
    for (const entry of this.leafEntries()) yield entry.values;
  }
  *intersectingLeaves(rect) {
    for (const entry of this.leafEntries(rect)) yield entry.values;
  }
}
module.exports = { PersistentInkOrder, LEAF, FANOUT, MAX_LENGTH, MAX_LOCATOR };
