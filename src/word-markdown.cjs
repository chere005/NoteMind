// Word-only semantic Markdown stream reuses rules with a compact block ledger.
const { md, mime } = require("./document-renderer.cjs");
const PAGE = 8192, MAX_TEXT = 16 * 1024 * 1024;
class BlockSink {
  constructor(check) {
    this.check = check;
    this.pages = [];
    this.count = 0;
    this.pending = null;
    this.consume = null;
    this.work = 0;
    this.last = [];
    this.info = { level: 0, type: "", hidden: false };
    const target = [];
    this.tokens = new Proxy(target, { get: (_target, key) => {
      if (key === "length") return this.count;
      if (key === "push") return (token) => this.push(token);
      if (typeof key === "string" && /^\d+$/.test(key)) {
        const index = Number(key), value = this.pages[Math.floor(index / PAGE)]?.[index % PAGE] || 0;
        this.info.level = value >>> 1;
        this.info.type = value & 1 ? "paragraph_open" : "";
        return this.info;
      }
      return Reflect.get(target, key);
    } });
  }
  flush() {
    if (!this.pending) return;
    const token = this.pending;
    this.pending = null;
    if (this.consume) this.consume(token, this.last);
    this.last.push(token.type);
    if (this.last.length > 2) this.last.shift();
  }
  push(token) {
    this.flush();
    const page = Math.floor(this.count / PAGE);
    this.pages[page] ||= new Uint16Array(PAGE);
    this.pages[page][this.count % PAGE] = token.level << 1 | (token.type === "paragraph_open" ? 1 : 0);
    this.count++;
    this.pending = token;
    if (++this.work % 4096 === 0) this.check();
    return this.count;
  }
  reset(consume) {
    this.flush();
    this.count = 0;
    this.pending = null;
    this.consume = consume;
    this.last.length = 0;
    this.work = 0;
  }
  get typedBytes() {
    return this.pages.length * PAGE * 2;
  }
}
function streamMarkdown(text, onToken, { check = () => {
}, onStats } = {}) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_TEXT) throw Error("Invalid Word export text.");
  if (typeof onToken !== "function") throw TypeError("Word token consumer is required.");
  check();
  const coreRules = md.core.ruler.__rules__;
  if (!Array.isArray(coreRules) || typeof md.block.State !== "function") throw Error("The Word Markdown parser is unavailable.");
  const active = (name) => coreRules.find((rule) => rule.name === name && !rule.enabled === false)?.fn, normalizer = coreRules.find((rule) => rule.name === "normalize")?.fn;
  if (typeof normalizer !== "function") throw Error("The Word Markdown normalizer is unavailable.");
  const env = {}, core = new md.core.State(text, md, env);
  normalizer(core);
  const sink = new BlockSink(check), state = new md.block.State(core.src, md, env, sink.tokens);
  md.block.tokenize(state, 0, state.lineMax);
  sink.flush();
  check();
  const inlineRules = coreRules.filter((rule) => rule.enabled && !["normalize", "block", "strip_references", "inline", "tasks"].includes(rule.name)).map((rule) => rule.fn);
  sink.reset((token, previous) => {
    if (token.type === "reference_definition") return;
    if (token.type === "inline") {
      token.children = [];
      md.inline.parse(token.content, md, env, token.children);
      if (previous[previous.length - 1] === "paragraph_open" && previous[previous.length - 2] === "list_item_open") {
        const first = token.children[0];
        if (first?.type === "text" && /^\[[ xX]\] /.test(first.content)) {
          const checked = first.content[1].toLowerCase() === "x";
          first.content = first.content.slice(4);
          const task = new core.Token("task_check", "input", 0);
          task.meta = { checked };
          token.children.unshift(task);
        }
      }
      const inline = new md.core.State("", md, env);
      inline.tokens = [token];
      for (const rule of inlineRules) rule(inline);
    }
    onToken(token);
  });
  Object.assign(state, { line: 0, level: 0, tight: false, blkIndent: 0, listIndent: -1, parentType: "root" });
  md.block.tokenize(state, 0, state.lineMax);
  sink.flush();
  check();
  onStats?.({ blockTokens: sink.count, blockLedgerBytes: sink.typedBytes, sourceLines: state.lineMax });
}
function imageNames(doc, options) {
  if (typeof doc?.text !== "string" || Buffer.byteLength(doc.text) > MAX_TEXT) throw Error("Invalid Word export text.");
  if (!Object.keys(doc.assets || {}).length) return [];
  const names = /* @__PURE__ */ new Set();
  streamMarkdown(doc.text, (token) => {
    for (const item of token.children || []) {
      const name = item.attrGet?.(item.type === "image" ? "src" : item.type === "link_open" ? "href" : "");
      if (item.type === "image" && mime(name) && Object.hasOwn(doc.assets || {}, name)) names.add(name);
      if (item.type === "link_open") {
        const thumb = doc.meta?.attachments?.[name]?.thumbnail;
        if (thumb && mime(thumb) && Object.hasOwn(doc.assets || {}, thumb)) names.add(thumb);
      }
    }
  }, options);
  return [...names];
}
module.exports = { streamMarkdown, imageNames, BlockSink };
