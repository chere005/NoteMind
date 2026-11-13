


const METADATA_PROPS = 14

function varint(bytes: Uint8Array, at: number): [value: number, next: number] {
  let value = 0, scale = 1, next = at
  for (;;) {
    if (next >= bytes.length) throw new Error("ONNX: truncated varint")
    const byte = bytes[next++]!
    value += (byte & 0x7f) * scale
    if ((byte & 0x80) === 0) return [value, next]
    scale *= 128
  }
}


function* fields(bytes: Uint8Array): Generator<[field: number, body: Uint8Array]> {
  let at = 0
  while (at < bytes.length) {
    const [tag, next] = varint(bytes, at)
    at = next
    const field = Math.floor(tag / 8), wire = tag & 7
    if (wire === 0) at = varint(bytes, at)[1]
    else if (wire === 1) at += 8
    else if (wire === 5) at += 4
    else if (wire === 2) {
      const [length, start] = varint(bytes, at)
      yield [field, bytes.subarray(start, start + length)]
      at = start + length
    } else throw new Error(`ONNX: unsupported wire type ${wire}`)
  }
}

const utf8 = new TextDecoder("utf-8")


export function onnxMetadata(model: Uint8Array): Map<string, string> {
  const out = new Map<string, string>()
  for (const [field, body] of fields(model)) {
    if (field !== METADATA_PROPS) continue
    let key = "", value = ""
    for (const [inner, text] of fields(body)) {
      if (inner === 1) key = utf8.decode(text)
      else if (inner === 2) value = utf8.decode(text)
    }
    out.set(key, value)
  }
  return out
}


export function ctcAlphabet(model: Uint8Array): string[] | null {
  const characters = onnxMetadata(model).get("character")
  if (!characters) return null
  return ["", ...characters.split(/\r?\n/).filter((line, at, all) => line !== "" || at < all.length - 1), " "]
}
