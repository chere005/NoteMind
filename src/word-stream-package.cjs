// Worker-only DOCX XML spools keep document-sized models out of the heap.
const fs = require("node:fs"), fsp = require("node:fs/promises"), path = require("node:path"), { createHash } = require("node:crypto");
const { exportWord } = require("./documents.cjs"), { readWordTemplate } = require("./word-template.cjs"), { streamMarkdown } = require("./word-markdown.cjs");
const CHUNK = 65536, MAX = 4294967295, identity = (s) => ["dev", "ino"].map((k) => String(s[k])).join(":"), stamp = (s) => ["dev", "ino", "size", "mtimeNs", "ctimeNs"].map((k) => String(s[k])).join(":");
class XMLSpool {
  constructor(owner, name) {
    this.owner = owner;
    this.file = path.join(owner.directory, name);
    this.fd = fs.openSync(this.file, "wx", 384);
    this.inode = identity(fs.fstatSync(this.fd, { bigint: true }));
    this.pending = [];
    this.characters = 0;
    this.bytes = 0;
    this.hash = createHash("sha256");
    owner.files.push(this);
  }
  write(value) {
    value = String(value);
    for (let at = 0; at < value.length; ) {
      let end = Math.min(value.length, at + 32768);
      if (end < value.length && value.charCodeAt(end - 1) >= 55296 && value.charCodeAt(end - 1) <= 56319) end--;
      const piece = value.slice(at, end);
      this.pending.push(piece);
      this.characters += piece.length;
      at = end;
      if (this.characters >= 32768) this.flush();
    }
  }
  flush() {
    if (!this.pending.length) return;
    const bytes = Buffer.from(this.pending.join(""));
    this.pending.length = 0;
    this.characters = 0;
    this.writeBytes(bytes);
  }
  writeBytes(bytes) {
    this.owner.check();
    if (this.bytes + bytes.length > MAX) throw Error("The Word XML exceeds the ZIP32 size limit.");
    let at = 0;
    while (at < bytes.length) {
      this.owner.check();
      const n = fs.writeSync(this.fd, bytes, at, bytes.length - at);
      if (!n) throw Error("Word XML write stopped.");
      at += n;
    }
    this.hash.update(bytes);
    this.bytes += bytes.length;
  }
  finish() {
    if (this.result) return this.result;
    this.flush();
    this.expected = stamp(fs.fstatSync(this.fd, { bigint: true }));
    fs.closeSync(this.fd);
    this.fd = null;
    this.result = { bytes: this.bytes, sha256: this.hash.digest("hex"), store: false, source: () => this.source() };
    return this.result;
  }
  assert() {
    const stat = fs.lstatSync(this.file, { bigint: true });
    if (stat.isSymbolicLink()) throw Error("Word XML spool changed.");
    this.assertStat(stat);
  }
  assertStat(stat) {
    if (!stat.isFile() || stamp(stat) !== this.expected) throw Error("Word XML spool changed.");
  }
  async *source() {
    this.assert();
    const handle = await fsp.open(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      this.assertStat(await handle.stat({ bigint: true }));
      const bytes = Buffer.allocUnsafeSlow(CHUNK);
      let at = 0;
      while (at < this.bytes) {
        this.owner.check();
        const { bytesRead } = await handle.read(bytes, 0, Math.min(bytes.length, this.bytes - at), at);
        if (!bytesRead) throw Error("Word XML spool was truncated.");
        at += bytesRead;
        yield bytes.subarray(0, bytesRead);
      }
      this.assertStat(await handle.stat({ bigint: true }));
      this.assert();
    } finally {
      await handle.close();
    }
  }
  copyTo(other) {
    this.finish();
    this.assert();
    other.flush();
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)), bytes = Buffer.allocUnsafeSlow(CHUNK), hash = createHash("sha256");
    try {
      this.assertStat(fs.fstatSync(fd, { bigint: true }));
      let at = 0;
      while (at < this.bytes) {
        this.owner.check();
        const count = fs.readSync(fd, bytes, 0, Math.min(bytes.length, this.bytes - at), at);
        if (!count) throw Error("Word XML spool was truncated.");
        const part = bytes.subarray(0, count);
        hash.update(part);
        other.writeBytes(part);
        at += count;
      }
      this.assertStat(fs.fstatSync(fd, { bigint: true }));
      this.assert();
      if (hash.digest("hex") !== this.result.sha256) throw Error("Word XML source digest changed.");
    } finally {
      fs.closeSync(fd);
    }
  }
  remove() {
    if (this.removed) return;
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    let stat;
    try {
      stat = fs.lstatSync(this.file, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        this.removed = true;
        return;
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || identity(stat) !== this.inode) throw Error("Word XML temporary identity changed.");
    fs.unlinkSync(this.file);
    this.removed = true;
  }
}
function escaped(writer, value, attribute = false) {
  value = String(value);
  for (let at = 0; at < value.length; ) {
    let end = Math.min(value.length, at + 16384);
    if (end < value.length && value.charCodeAt(end - 1) >= 55296 && value.charCodeAt(end - 1) <= 56319) end--;
    let text = value.slice(at, end).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "\uFFFD").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
    if (attribute) text = text.replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;").replace(/\t/g, "&#x9;");
    writer.write(text);
    at = end;
  }
}
function properties(style, hyperlink) {
  let xml = "";
  if (hyperlink) xml += '<w:rStyle w:val="Hyperlink"/>';
  if (style.bold) xml += "<w:b/><w:bCs/>";
  if (style.italics) xml += "<w:i/><w:iCs/>";
  if (style.strike) xml += "<w:strike/>";
  if (style.highlight) xml += '<w:highlight w:val="yellow"/>';
  if (style.underline) xml += '<w:u w:val="single"/>';
  if (style.code) xml += '<w:rFonts w:ascii="Consolas" w:cs="Consolas" w:eastAsia="Consolas" w:hAnsi="Consolas"/><w:shd w:fill="F3F3F3" w:color="auto"/>';
  if (style.size) xml += '<w:sz w:val="' + style.size + '"/><w:szCs w:val="' + style.size + '"/>';
  return xml ? "<w:rPr>" + xml + "</w:rPr>" : "";
}
class RowBuffer {
  constructor(owner) {
    this.owner = owner;
    this.parts = [];
    this.length = 0;
    this.spool = null;
  }
  write(text) {
    if (this.spool) return this.spool.write(text);
    this.parts.push(text);
    this.length += text.length;
    if (this.length > CHUNK) {
      this.spool = new XMLSpool(this.owner, "row-" + ++this.owner.next + ".xml");
      for (const part of this.parts) this.spool.write(part);
      this.parts.length = 0;
    }
  }
  replay(writer) {
    if (this.spool) {
      this.spool.copyTo(writer);
      this.spool.remove();
    } else for (const part of this.parts) writer.write(part);
    this.parts.length = 0;
  }
}
async function wordStreamPackage(doc, images, options, { spoolRoot, check = () => {
} } = {}) {
  if (typeof spoolRoot !== "string" || !path.isAbsolute(spoolRoot)) throw Error("Word XML requires a private spool folder.");
  check();
  const directory = await fsp.mkdtemp(path.join(spoolRoot, "xml-")), rootStat = await fsp.lstat(directory, { bigint: true }), owner = { directory, files: [], next: 0, check }, release = async () => {
    let failure;
    for (const file of owner.files) try {
      file.remove();
    } catch (error) {
      failure ||= error;
    }
    try {
      const stat = await fsp.lstat(directory, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || identity(stat) !== identity(rootStat)) throw Error("Word XML temporary folder changed.");
      await fsp.rmdir(directory);
    } catch (error) {
      if (error.code !== "ENOENT") failure ||= error;
    }
    if (failure) throw failure;
  };
  try {
    let paragraph2 = function(writer, { code = false } = {}) {
      writer.write("<w:p>");
      let props = "";
      if (cell) {
        if (alignment) props += '<w:jc w:val="' + alignment + '"/>';
      } else {
        if (!code && heading) props += '<w:pStyle w:val="Heading' + heading + '"/>';
        else if (!code && lists.length) props += '<w:pStyle w:val="ListParagraph"/>';
        if (!code && lists.length) props += '<w:numPr><w:ilvl w:val="' + Math.min(8, lists.length - 1) + '"/><w:numId w:val="' + lists.at(-1).id + '"/></w:numPr>';
        if (!code && quote) props += '<w:pBdr><w:left w:val="single" w:color="A0A0A0" w:sz="12" w:space="12"/></w:pBdr><w:ind w:left="' + quote * 480 + '"/>';
        if (code) props += '<w:shd w:fill="F3F3F3" w:color="auto"/>';
        props += '<w:spacing w:after="' + (code ? 0 : 120) + '"/>';
      }
      if (props) writer.write("<w:pPr>" + props + "</w:pPr>");
      paragraphs++;
    }, image2 = function(writer, name, alt, max = 560, link = null) {
      const item = media.get(name);
      if (!item) throw Error("Missing document image: " + name);
      const width = Math.min(item.info.width, max), height = width * item.info.height / item.info.width, cx = Math.round(width * 9525), cy = Math.round(height * 9525), id = ++drawing;
      if (link) writer.write('<w:hyperlink r:id="' + link + '" w:history="1">');
      writer.write('<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent t="0" r="0" b="0" l="0"/><wp:docPr id="' + id + '" name="');
      escaped(writer, alt, true);
      writer.write('" descr="');
      escaped(writer, alt, true);
      writer.write('" title="');
      escaped(writer, alt, true);
      writer.write('"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="" descr=""/><pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + item.rid + '" cstate="none"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>');
      if (link) writer.write("</w:hyperlink>");
    }, run2 = function(writer, style, text, link, br = false) {
      if (link) writer.write('<w:hyperlink r:id="' + link + '" w:history="1">');
      writer.write("<w:r>" + properties(style, link));
      if (br) writer.write("<w:br/>");
      else {
        writer.write('<w:t xml:space="preserve">');
        escaped(writer, text);
        writer.write("</w:t>");
      }
      writer.write("</w:r>");
      if (link) writer.write("</w:hyperlink>");
    }, inline2 = function(writer, tokens) {
      let style = {}, link = null;
      const stack = [];
      for (const token of tokens || []) {
        check();
        const type = token.type;
        if (["mark_open", "u_open", "strong_open", "em_open", "s_open"].includes(type)) {
          stack.push(style);
          style = { ...style, [{ mark_open: "highlight", u_open: "underline", strong_open: "bold", em_open: "italics", s_open: "strike" }[type]]: true };
        } else if (["mark_close", "u_close", "strong_close", "em_close", "s_close"].includes(type)) style = stack.pop() || {};
        else if (type === "link_open") {
          const href = token.attrGet("href"), attachment = doc.meta?.attachments?.[href];
          if (attachment) {
            link = null;
            if (media.has(attachment.thumbnail)) {
              image2(writer, attachment.thumbnail, "", 300);
              run2(writer, style, "", null, true);
            }
          } else {
            link = "rIdNmLink" + ++relation;
            relationships.write('<Relationship Id="' + link + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="');
            escaped(relationships, href, true);
            relationships.write('" TargetMode="External"/>');
          }
        } else if (type === "link_close") link = null;
        else if (type === "text" || type === "code_inline") run2(writer, type === "code_inline" ? { ...style, code: true } : style, token.content, link);
        else if (type === "softbreak" || type === "hardbreak") run2(writer, style, "", link, true);
        else if (type === "image") image2(writer, token.attrGet("src"), token.content, 560, link);
        else if (type === "task_check") {
          const checked = token.meta.checked, symbol = checked ? "2612" : "2610";
          writer.write('<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="' + (checked ? 1 : 0) + '"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:sym w:char="' + symbol + '" w:font="MS Gothic"/></w:r></w:sdtContent></w:sdt>');
          run2(writer, style, " ", link);
        }
      }
    }, finishFirstRow2 = function() {
      output.write('<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="5000"/><w:tblBorders>');
      for (const side of ["top", "left", "bottom", "right", "insideH", "insideV"]) output.write("<w:" + side + ' w:val="single" w:color="auto" w:sz="4"/>');
      output.write("</w:tblBorders></w:tblPr><w:tblGrid>");
      const width = Math.round((options.pageSize === "A4" ? 9746 : 10080) / Math.max(1, table.columns));
      for (let i = 0; i < table.columns; i++) output.write('<w:gridCol w:w="' + width + '"/>');
      output.write("</w:tblGrid>");
      table.first.replay(output);
      table.first = null;
    };
    var paragraph = paragraph2, image = image2, run = run2, inline = inline2, finishFirstRow = finishFirstRow2;
    const base = readWordTemplate(await exportWord({ text: "", title: doc.title, assets: {} }, {}, options)), document = base["word/document.xml"].toString(), body = document.indexOf("<w:body>") + 8, section = document.lastIndexOf("<w:sectPr>"), rels = base["word/_rels/document.xml.rels"].toString(), numbering = base["word/numbering.xml"].toString(), numbersAt = numbering.indexOf("<w:num ");
    if (body < 8 || section < body || numbersAt < 0) throw Error("Word template structure changed.");
    const output = new XMLSpool(owner, "document.xml"), relationships = new XMLSpool(owner, "relationships.xml"), abstracts = new XMLSpool(owner, "abstracts.xml"), numbers = new XMLSpool(owner, "numbers.xml");
    output.write(document.slice(0, body));
    relationships.write(rels.slice(0, rels.lastIndexOf("</Relationships>")));
    abstracts.write(numbering.slice(0, numbersAt));
    numbers.write(numbering.slice(numbersAt, numbering.lastIndexOf("</w:numbering>")));
    const media = /* @__PURE__ */ new Map(), resources = /* @__PURE__ */ new Map(), mediaEntries = [];
    let relation = 0, drawing = 0, ordered = 1;
    for (const [name, image3] of Object.entries(images)) {
      const key = image3.type + ":" + image3.contentHash;
      let item = resources.get(key);
      if (!item) {
        const file = "notemind-" + (resources.size + 1) + "." + image3.type, rid = "rIdNmImage" + (resources.size + 1);
        item = { rid, file };
        resources.set(key, item);
        mediaEntries.push({ name: "word/media/" + file, image: name, store: true });
        relationships.write('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + file + '"/>');
      }
      media.set(name, { ...item, info: image3 });
    }
    let heading = 0, quote = 0, cell = false, alignment = "", table = null;
    const lists = [];
    let paragraphs = 0;
    streamMarkdown(doc.text, (token) => {
      const type = token.type, writer = table?.first || output;
      if (type === "heading_open") heading = Number(token.tag.slice(1));
      else if (type === "heading_close") heading = 0;
      else if (type === "blockquote_open") quote++;
      else if (type === "blockquote_close") quote = Math.max(0, quote - 1);
      else if (type === "bullet_list_open") lists.push({ id: 1 });
      else if (type === "ordered_list_open") {
        const id = ++ordered, level = Math.min(8, lists.length), start = token.attrGet("start") === null ? 1 : Number(token.attrGet("start"));
        abstracts.write('<w:abstractNum w:abstractNumId="' + id + '" w15:restartNumberingAfterBreak="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="' + level + '"><w:start w:val="' + start + '"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%' + (level + 1) + '."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + 720 * (level + 1) + '" w:hanging="260"/></w:pPr></w:lvl></w:abstractNum>');
        numbers.write('<w:num w:numId="' + id + '"><w:abstractNumId w:val="' + id + '"/><w:lvlOverride w:ilvl="' + level + '"><w:startOverride w:val="' + start + '"/></w:lvlOverride></w:num>');
        lists.push({ id });
      } else if (type === "bullet_list_close" || type === "ordered_list_close") lists.pop();
      else if (type === "inline") {
        paragraph2(writer);
        inline2(writer, token.children);
        writer.write("</w:p>");
      } else if (type === "fence" || type === "code_block") {
        let code = token.content.trimEnd(), at = 0;
        for (; ; ) {
          const end = code.indexOf("\n", at), line = code.slice(at, end < 0 ? code.length : end);
          paragraph2(writer, { code: true });
          run2(writer, { code: true, size: 20 }, line, null);
          writer.write("</w:p>");
          if (end < 0) break;
          at = end + 1;
        }
      } else if (type === "hr") {
        writer.write('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:color="AAAAAA" w:space="1" w:sz="4"/></w:pBdr></w:pPr></w:p>');
        paragraphs++;
      } else if (type === "table_open") {
        if (table) throw Error("Nested Word tables are unsupported.");
        table = { first: new RowBuffer(owner), columns: 0 };
      } else if (type === "tr_open") writer.write('<w:tr><w:trPr><w:tblHeader w:val="off"/></w:trPr>');
      else if (type === "th_open" || type === "td_open") {
        cell = true;
        alignment = /text-align:\s*(right|center)/i.exec(token.attrGet("style") || "")?.[1] || "";
        if (table.first) table.columns++;
        writer.write("<w:tc>");
      } else if (type === "th_close" || type === "td_close") {
        writer.write("</w:tc>");
        cell = false;
        alignment = "";
      } else if (type === "tr_close") {
        writer.write("</w:tr>");
        if (table.first) finishFirstRow2();
      } else if (type === "table_close") {
        output.write("</w:tbl>");
        table = null;
      }
    }, { check, consumeInline: true });
    if (!paragraphs) output.write("<w:p/>");
    output.write(document.slice(section));
    relationships.write("</Relationships>");
    numbers.write("</w:numbering>");
    numbers.copyTo(abstracts);
    const replaced = /* @__PURE__ */ new Set(["word/document.xml", "word/_rels/document.xml.rels", "word/numbering.xml"]), entries = Object.entries(base).filter(([name]) => !replaced.has(name)).map(([name, data]) => ({ name, data, store: false }));
    entries.push({ name: "word/document.xml", ...output.finish() }, { name: "word/_rels/document.xml.rels", ...relationships.finish() }, { name: "word/numbering.xml", ...abstracts.finish() }, ...mediaEntries);
    return { entries, images: resources.size, metadataBytes: entries.filter((entry) => !entry.image).reduce((sum, entry) => sum + (entry.data !== void 0 ? entry.data.length : entry.bytes), 0), release };
  } catch (error) {
    try {
      await release();
    } catch (cleanup) {
      error.wordCleanupError = cleanup.message;
    }
    throw error;
  }
}
module.exports = { wordStreamPackage, XMLSpool, RowBuffer };
