// Word-private inline storage keeps the installed Markdown rules without a Token object per fragment.
const {linkMatches} = require('./word-link-matches.cjs');
const PAGE = 8192, ROW = Symbol('word inline row'), childPackets = new WeakMap(), owners = new WeakMap();
class Strings {
  constructor() { this.values = ['']; this.short = new Map([['', 0]]); }
  put(value) {
    value = value == null ? '' : String(value);
    if (value.length <= 128) {
      const known = this.short.get(value); if (known !== undefined) return known;
      const id = this.values.length; this.values.push(value);
      if (this.short.size < 65536) this.short.set(value, id);
      return id;
    }
    const id = this.values.length; this.values.push(value); return id;
  }
  get(id) { return this.values[id] || ''; }
}
class Column {
  constructor(Type) { this.Type = Type; this.pages = []; }
  get(i) { return this.pages[i >>> 13]?.[i & (PAGE - 1)] || 0; }
  set(i, value) {
    const at=i >>> 13;let page=this.pages[at];
    if(this.Type===Uint32Array){
      value=value>>>0;
      if(!page&&!value)return;
      const Type=value<=255?Uint8Array:value<=65535?Uint16Array:Uint32Array;
      if(!page)page=this.pages[at]=new Type(PAGE);
      else if(Type.BYTES_PER_ELEMENT>page.BYTES_PER_ELEMENT){const grown=new Type(PAGE);grown.set(page);discard(page.buffer);page=this.pages[at]=grown;}
    }else page ||=this.pages[at]=new this.Type(PAGE);
    page[i & (PAGE - 1)]=value;
  }
  get bytes() { return this.pages.reduce((sum,page)=>sum+(page?.byteLength||0),0); }
  release() { for (const page of this.pages) if(page)discard(page.buffer); this.pages.length = 0; }
}
class Cache {
  constructor() { this.values = new Map(); this.order = new Array(256); this.next = 0; }
  get(key, make) { let value = this.values.get(key); if (!value) { value = make(); if (!this.values.has(key)) { if (this.values.size === 256) this.values.delete(this.order[this.next]); this.order[this.next] = key; this.next = (this.next + 1) & 255; } this.values.set(key, value); } return value; }
}
const discard = buffer => { if (typeof buffer.transfer === 'function') buffer.transfer(0); else structuredClone(buffer, {transfer: [buffer]}); };
const isIndex = key => typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key);
class TokenView {
  constructor(store, row) { this.store = store; this[ROW] = row; }
  get type() { return this.store.names[this.store.type.get(this[ROW])]; }
  set type(v) { this.store.type.set(this[ROW], this.store.name(v)); }
  get tag() { return this.store.names[this.store.tag.get(this[ROW])]; }
  set tag(v) { this.store.tag.set(this[ROW], this.store.name(v)); }
  get content() { return this.store.strings.get(this.store.content.get(this[ROW])); }
  set content(v) { this.store.content.set(this[ROW], this.store.strings.put(v)); }
  get level() { return this.store.level.get(this[ROW]); }
  set level(v) { this.store.level.set(this[ROW], v); }
  get nesting() { return this.store.nesting.get(this[ROW]); }
  set nesting(v) { this.store.nesting.set(this[ROW], v); }
  get attrs() { return this.store.readAttrs(this[ROW]); }
  set attrs(v) { this.store.writeAttrs(this[ROW], v); }
  get meta() { const id = this.store.meta.get(this[ROW]); if (!id) return null; const value = JSON.parse(this.store.strings.get(id >>> 1)); return id & 1 ? Object.assign(Object.create(null), value) : value; }
  set meta(v) { this.store.meta.set(this[ROW], v == null ? 0 : this.store.strings.put(JSON.stringify(v)) * 2 + (Object.getPrototypeOf(v) === null ? 1 : 0)); }
  get children() { return this.store.children.get(this[ROW]) || null; }
  set children(v) { if (v == null) this.store.children.delete(this[ROW]); else this.store.children.set(this[ROW], childPackets.get(v) || v); }
  // These rendering-only fields are not consumed by Word's semantic writer.
  get markup() { return ''; } set markup(_) {}
  get info() { return ''; } set info(_) {}
  get block() { return false; } set block(_) {}
  get hidden() { return false; } set hidden(_) {}
  attrIndex(name) { return this.attrs?.findIndex(pair => pair[0] === name) ?? -1; }
  attrGet(name) { return this.attrs?.find(pair => pair[0] === name)?.[1] ?? null; }
  attrSet(name, value) { const attrs = this.attrs || [], at = attrs.findIndex(pair => pair[0] === name); if (at < 0) attrs.push([name, value]); else attrs[at][1] = value; this.attrs = attrs; }
  attrPush(pair) { const attrs = this.attrs || []; attrs.push(pair); this.attrs = attrs; }
  attrJoin(name, value) { const previous = this.attrGet(name); this.attrSet(name, previous == null ? value : previous + ' ' + value); }
}
class Tokens {
  constructor(check) {
    this.check = check; this.work = 0; this.count = 0; this.rows = 0; this.names = ['']; this.nameIds = new Map([['', 0]]); this.strings = new Strings(); this.cache = new Cache(); this.children = new Map(); this.pendingAttrs = null;
    this.type = new Column(Uint8Array); this.tag = new Column(Uint8Array); this.content = new Column(Uint32Array); this.attrs = new Column(Uint32Array); this.meta = new Column(Uint32Array); this.level = new Column(Int32Array); this.nesting = new Column(Int8Array); this.order = new Column(Uint32Array);
    this.tokens = new Proxy([], {
      get: (target, key) => {
        if (key === 'length') return this.count;
        if (key === Symbol.iterator) return function* () { for (let i = 0; i < this.count; i++) yield this.at(i); }.bind(this);
        if (key === 'push') return (...values) => { for (const value of values) this.push(value); return this.count; };
        if (key === 'unshift') return (...values) => { const n = values.length, old = this.count; for (let i = old - 1; i >= 0; i--) this.set(i + n, this.at(i)); for (let i = 0; i < n; i++) this.set(i, values[i]); return this.count; };
        if (key === 'map') return callback => { const out = []; for (let i = 0; i < this.count; i++) out.push(callback(this.at(i), i, this.tokens)); return out; };
        if (isIndex(key)) return this.at(Number(key));
        return Reflect.get(target, key);
      },
      set: (_target, key, value) => { if (key === 'length') { if (!Number.isSafeInteger(value) || value < 0 || value > this.count) throw Error('Invalid Word token length.'); this.count = value; return true; } if (isIndex(key)) { this.set(Number(key), value); return true; } throw Error('Unsupported Word token mutation.'); },
      has: (target, key) => isIndex(key) ? Number(key) < this.count : Reflect.has(target, key)
    });
    owners.set(this.tokens, this);
  }
  touch() { if (++this.work % 4096 === 0) this.check(); }
  name(value) { value = String(value); let id = this.nameIds.get(value); if (id === undefined) { id = this.names.length; if (id > 255) throw Error('Unsupported Word token type.'); this.nameIds.set(value, id); this.names.push(value); } return id; }
  create(type, tag, nesting) { this.flushAttrs(); const row = this.rows++, token = this.view(row); token.type = type; token.tag = tag; token.nesting = nesting; this.touch(); return token; }
  view(row) { return this.cache.get(row, () => new TokenView(this, row)); }
  at(i) { this.touch(); return i >= 0 && i < this.count ? this.view(this.order.get(i)) : undefined; }
  adopt(value) { if (value instanceof TokenView && value.store === this) return value[ROW]; const token = this.create(value.type, value.tag, value.nesting); token.content = value.content; token.level = value.level; token.attrs = value.attrs; token.meta = value.meta; token.children = value.children; return token[ROW]; }
  set(i, value) { if (!Number.isSafeInteger(i) || i < 0) throw Error('Invalid Word token position.'); this.order.set(i, this.adopt(value)); this.count = Math.max(this.count, i + 1); this.touch(); }
  push(value) { this.set(this.count, value); return this.count; }
  flushAttrs() { if (!this.pendingAttrs) return; const {row, value} = this.pendingAttrs; this.pendingAttrs = null; this.attrs.set(row, value == null ? 0 : this.strings.put(JSON.stringify(value))); }
  readAttrs(row) { if (this.pendingAttrs?.row === row) return this.pendingAttrs.value; const id = this.attrs.get(row); return id ? JSON.parse(this.strings.get(id)) : null; }
  writeAttrs(row, value) { this.flushAttrs(); this.pendingAttrs = {row, value}; }
  get typedBytes() { return ['type','tag','content','attrs','meta','level','nesting','order'].reduce((sum,key) => sum + this[key].bytes, 0); }
}
class DelimiterView {
  constructor(pool, row) { this.pool = pool; this.row = row; }
  get marker() { return this.pool.marker.get(this.row); } set marker(v) { this.pool.marker.set(this.row, v); }
  get length() { return this.pool.length.get(this.row); } set length(v) { this.pool.length.set(this.row, v); }
  get token() { return this.pool.token.get(this.row); } set token(v) { this.pool.token.set(this.row, v); }
  get end() { return this.pool.end.get(this.row) - 1; } set end(v) { this.pool.end.set(this.row, v + 1); }
  get open() { return !!(this.pool.flags.get(this.row) & 1); } set open(v) { const f = this.pool.flags.get(this.row); this.pool.flags.set(this.row, v ? f | 1 : f & ~1); }
  get close() { return !!(this.pool.flags.get(this.row) & 2); } set close(v) { const f = this.pool.flags.get(this.row); this.pool.flags.set(this.row, v ? f | 2 : f & ~2); }
}
class Delimiters {
  constructor(check) { this.check = check; this.work = 0; this.rows = 0; this.lists = 0; this.marker = new Column(Uint8Array); this.length = new Column(Uint32Array); this.token = new Column(Uint32Array); this.end = new Column(Uint32Array); this.flags = new Column(Uint8Array); this.listId = new Column(Uint32Array); this.first = new Column(Uint32Array); this.count = new Column(Uint32Array); this.last = new Column(Uint32Array); this.noncontiguous = new Column(Uint8Array); this.offset = new Column(Uint32Array); this.cache = new Cache(); this.listCache = new Cache(); }
  touch() { if (++this.work % 4096 === 0) this.check(); }
  makeList(attach) {
    let id = 0;
    const list = new Proxy([], { get: (_target, key) => {
      if (key === 'length') return id ? this.count.get(id) : 0;
      if (key === 'push') return value => { if (!id) { id = ++this.lists; attach?.(id); } this.add(id, value); return this.count.get(id); };
      if (isIndex(key)) return id ? this.at(id, Number(key)) : undefined;
      return undefined;
    } });
    return { list, id: () => id };
  }
  add(id, value) { const row = this.rows++, n = this.count.get(id); if (!n) this.first.set(id, row); else if (this.last.get(id) + 1 !== row) this.noncontiguous.set(id, 1); this.last.set(id, row); this.count.set(id, n + 1); this.listId.set(row, id); this.marker.set(row, value.marker); this.length.set(row, value.length); this.token.set(row, value.token); this.end.set(row, value.end + 1); this.flags.set(row, (value.open ? 1 : 0) | (value.close ? 2 : 0)); this.touch(); }
  seal() {
    let total = 0; for (let id = 1; id <= this.lists; id++) if (this.noncontiguous.get(id)) { this.offset.set(id, total); total += this.count.get(id); }
    this.order = new Uint32Array(total); const used = new Column(Uint32Array);
    if (total) for (let row = 0; row < this.rows; row++) { const id = this.listId.get(row); if (this.noncontiguous.get(id)) { const at = used.get(id); this.order[this.offset.get(id) + at] = row; used.set(id, at + 1); } this.touch(); }
    this.listId.release();
  }
  at(id, i) { this.touch(); if (i < 0 || i >= this.count.get(id)) return undefined; const row = this.noncontiguous.get(id) ? this.order[this.offset.get(id) + i] : this.first.get(id) + i; return this.cache.get(row, () => new DelimiterView(this, row)); }
  list(id) { return this.listCache.get(id, () => new Proxy([], {get: (_target,key) => key === 'length' ? this.count.get(id) : isIndex(key) ? this.at(id, Number(key)) : undefined})); }
  get typedBytes() { return ['marker','length','token','end','flags','listId','first','count','last','noncontiguous','offset'].reduce((sum,key) => sum + this[key].bytes, this.order?.byteLength || 0); }
}
function parseInline(text, md, env, {check = () => {}, onStats} = {}) {
  const tokens = new Tokens(check), delimiters = new Delimiters(check), metaLists = new Column(Uint32Array); let metaLength = 0;
  const localMD = Object.create(md), localInline = Object.create(md.inline); localMD.inline = localInline;
  const ruleView = Object.create(md.inline.ruler), rules = md.inline.ruler.__rules__.filter(rule => rule.enabled).map(rule => {
    if (!['emphasis','strikethrough'].includes(rule.name)) return rule.fn;
    return (state, silent) => {
      const marker = state.src.charCodeAt(state.pos);
      if (!silent && (rule.name === 'emphasis' ? marker === 42 || marker === 95 : marker === 126)) {
        const run = state.scanDelims(state.pos, marker !== 95);
        // A run that cannot open or close can never participate in later pairing.
        if (!run.can_open && !run.can_close && (rule.name !== 'strikethrough' || run.length >= 2)) {
          state.pending += state.src.slice(state.pos, state.pos + run.length); state.pos += run.length; return true;
        }
      }
      return rule.fn(state, silent);
    };
  });
  ruleView.getRules = () => rules; localInline.ruler = ruleView;
  localInline.parse = (source, _md, childEnv, out) => { if (source.length < 32768) { md.inline.parse(source, md, childEnv, out); return; } const children = parseInline(source, md, childEnv, {check}); childPackets.set(out, children); };
  const state = new md.inline.State(text, localMD, env, tokens.tokens);
  const stack = []; let current = delimiters.makeList(); state.delimiters = current.list;
  state.tokens_meta = new Proxy([], {get: (_target,key) => { if (key === 'length') return metaLength; if (isIndex(key)) { const id = metaLists.get(Number(key)); return id ? {delimiters: delimiters.list(id)} : undefined; } return undefined; }});
  state.pushPending = function () { const token = tokens.create('text','',0); token.content = this.pending; token.level = this.pendingLevel; tokens.push(token); this.pending = ''; return token; };
  state.push = function (type, tag, nesting) {
    if (this.pending) this.pushPending();
    const token = tokens.create(type, tag, nesting), metaAt = metaLength++;
    if (nesting < 0) { this.level--; current = stack.pop(); if (!current) throw Error('Unbalanced Word inline state.'); this.delimiters = current.list; }
    token.level = this.level;
    if (nesting > 0) { this.level++; stack.push(current); current = delimiters.makeList(id => metaLists.set(metaAt, id)); this.delimiters = current.list; }
    this.pendingLevel = this.level; tokens.push(token); return token;
  };
  // Link-label lookahead is indexed by source position; typed pages avoid a sparse numeric-key object graph.
  const positions = new Column(Uint32Array);
  state.cache = new Proxy(Object.create(null), {get: (_target,key) => isIndex(key) ? (positions.get(Number(key)) || undefined) : undefined, set: (_target,key,value) => { if (!isIndex(key)) throw Error('Invalid Word inline cache key.'); positions.set(Number(key), value); return true; }});
  let complete = false;
  try {
  localInline.tokenize(state); tokens.flushAttrs(); delimiters.seal();
  for (const rule of md.inline.ruler2.__rules__.filter(rule => rule.enabled)) { check(); if (rule.name === 'balance_pairs') balancePairs(state, check); else if (rule.name === 'fragments_join') joinText(tokens.tokens, {levels: true, check}); else rule.fn(state); }
  tokens.flushAttrs(); check(); onStats?.({inlineTokens: tokens.count, inlineRows: tokens.rows, inlineTypedBytes: tokens.typedBytes, delimiterRows: delimiters.rows, delimiterTypedBytes: delimiters.typedBytes, cacheBytes: positions.bytes});
  complete = true; return tokens.tokens;
  } finally {
  for (const key of ['marker','length','token','end','flags','listId','first','count','last','noncontiguous','offset']) delimiters[key].release();
  if (delimiters.order?.byteLength) discard(delimiters.order.buffer);
  metaLists.release(); positions.release();
  if (!complete) { for (const key of ['type','tag','content','attrs','meta','level','nesting','order']) tokens[key].release(); tokens.children.clear(); tokens.strings.values.length = 0; }
  }
}
// Same Markdown delimiter pairing, with a fixed-width jump ledger rather than an expanding number array.
function balancePairs(state, check) {
  const process = delimiters => {
    const max = delimiters.length; if (!max) return;
    const bottom = Object.create(null), jumps = new Uint32Array(max); let header = 0, last = -2;
    try{for (let closerAt = 0; closerAt < max; closerAt++) {
      if (closerAt % 4096 === 0) check();
      const closer = delimiters[closerAt];
      if (delimiters[header].marker !== closer.marker || last !== closer.token - 1) header = closerAt;
      last = closer.token; closer.length = closer.length || 0;
      if (!closer.close) continue;
      const limits = bottom[closer.marker] ||= [-1,-1,-1,-1,-1,-1], min = limits[(closer.open ? 3 : 0) + closer.length % 3];
      let openerAt = header - jumps[header] - 1, newMin = openerAt;
      for (; openerAt > min; openerAt -= jumps[openerAt] + 1) {
        const opener = delimiters[openerAt]; if (opener.marker !== closer.marker) continue;
        if (opener.open && opener.end < 0) {
          const odd = (opener.close || closer.open) && (opener.length + closer.length) % 3 === 0 && (opener.length % 3 !== 0 || closer.length % 3 !== 0);
          if (!odd) {
            const jump = openerAt > 0 && !delimiters[openerAt - 1].open ? jumps[openerAt - 1] + 1 : 0;
            jumps[closerAt] = closerAt - openerAt + jump; jumps[openerAt] = jump;
            closer.open = false; opener.end = closerAt; opener.close = false; newMin = -1; last = -2; break;
          }
        }
      }
      if (newMin !== -1) limits[(closer.open ? 3 : 0) + (closer.length || 0) % 3] = newMin;
    }}finally{discard(jumps.buffer);}
  };
  process(state.delimiters);
  for (let i = 0; i < state.tokens_meta.length; i++) { if (i % 4096 === 0) check(); const list = state.tokens_meta[i]?.delimiters; if (list) process(list); }
}
function linkifyTokens(children, source, md, check) {
  const store = owners.get(children); if (!store) return false;
  if (!md.options.linkify || !md.linkify.test(source)) return true;
  const order = new Column(Uint32Array); let count = 0, depth = 0;
  const append = token => order.set(count++, store.adopt(token));
  const make = (type, tag, nesting, content, level) => { const token = store.create(type, tag, nesting); token.content = content; token.level = level; return token; };
  for (let i = 0; i < children.length; i++) {
    if (i % 4096 === 0) check();
    const token = children[i];
    if (token.type === 'link_close') { depth = Math.max(0, depth - 1); append(token); continue; }
    if (token.type === 'link_open') { depth++; append(token); continue; }
    if (depth || token.type !== 'text' || !md.linkify.test(token.content)) { append(token); continue; }
    const text = token.content; let last = 0, first = true;
    for (const link of linkMatches(md.linkify, text, check)) {
      if (first && link.index === 0 && i > 0 && children[i - 1].type === 'text_special') { first = false; continue; }
      first = false;
      const href = md.normalizeLink(link.url); if (!md.validateLink(href)) continue;
      let label = link.text;
      if (!link.schema) label = md.normalizeLinkText('http://' + label).replace(/^http:\/\//, '');
      else if (link.schema === 'mailto:' && !/^mailto:/i.test(label)) label = md.normalizeLinkText('mailto:' + label).replace(/^mailto:/, '');
      else label = md.normalizeLinkText(label);
      if (link.index > last) append(make('text','',0,text.slice(last, link.index), token.level));
      const open = make('link_open','a',1,'',token.level); open.attrs = [['href',href]]; append(open);
      append(make('text','',0,label,token.level + 1)); append(make('link_close','a',-1,'',token.level)); last = link.lastIndex;
    }
    if (last < text.length) append(last ? make('text','',0,text.slice(last),token.level) : token);
  }
  store.flushAttrs(); store.order.release(); store.order = order; store.count = count; return true;
}
function joinText(children, {levels = false, normalize = false, includeChildren = true, check = () => {}} = {}) {
  const store = owners.get(children); if (!store) return false;
  const order = new Column(Uint32Array); let count = 0, level = 0, last = null, parts = [], chunks = [], chars = 0;
  const flush = () => {
    if (!last) return;
    if (parts.length) chunks.push(parts.join(''));
    last.content = chunks.length === 1 ? chunks[0] : chunks.join('');
    order.set(count++, last[ROW]); last = null; parts = []; chunks = []; chars = 0;
  };
  for (let i = 0; i < children.length; i++) {
    if (i % 4096 === 0) check(); const token = children[i];
    if (normalize && token.type === 'text_special') token.type = 'text';
    if (normalize && includeChildren && token.children) {
      const nested = token.children;
      if (!joinText(nested, {normalize: true, includeChildren: false, check})) {
        for (const item of nested) if (item.type === 'text_special') item.type = 'text';
        let at = 0;
        for (let j = 0; j < nested.length; j++) if (nested[j].type === 'text' && j + 1 < nested.length && nested[j + 1].type === 'text') nested[j + 1].content = nested[j].content + nested[j + 1].content;
        else nested[at++] = nested[j];
        nested.length = at;
      }
    }
    if (levels) { if (token.nesting < 0) level--; token.level = level; if (token.nesting > 0) level++; }
    if (token.type === 'text') {
      last = token; const content = token.content; parts.push(content); chars += content.length;
      if (chars >= 32768) { chunks.push(parts.join('')); parts = []; chars = 0; }
    } else { flush(); order.set(count++, token[ROW]); }
  }
  flush(); store.order.release(); store.order = order; store.count = count; return true;
}
function releaseInline(children) {
  const store = owners.get(children); if (!store) return false;
  owners.delete(children);
  for (const nested of store.children.values()) releaseInline(nested);
  for (const key of ['type','tag','content','attrs','meta','level','nesting','order']) store[key].release();
  store.cache.values.clear(); store.children.clear(); store.pendingAttrs = null; store.strings.values.length = 0; store.strings.short.clear(); store.names.length = 0; store.nameIds.clear(); store.count = 0; return true;
}
module.exports = {parseInline, linkifyTokens, joinText, releaseInline, Tokens, Delimiters};
