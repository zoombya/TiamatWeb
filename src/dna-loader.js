/**
 * dna-loader.js — Raw MFC CArchive parser for Tiamat desktop .dna files.
 *
 * Tiamat saves designs as MFC CArchive binary. This module reads the same
 * raw object graph as the original application and extracts nucleobases,
 * links, sequences, geometry flags, and custom strand colors.
 *
 * Format (from Tiamat source, Constants.h: VERSION = VERSIONABLE_SCHEMA|5):
 *   4 × COpenGLWnd* panes  (CTop / CPerspective / CSide / CFront)
 *   int              bases.size()
 *   N × Nucleobase*  the actual design data
 *
 * Nucleobase schema versions 1-5 are handled.
 */

// ─── UTF-8 corruption reversal ──────────────────────────────────────────────

const UNKNOWN = -1; // sentinel for a lost byte

/**
 * Walk the corrupted byte stream, decode UTF-8 sequences and recover
 * original bytes.  Each U+FFFD becomes a single UNKNOWN marker (one
 * original byte was lost).  Valid multi-byte UTF-8 that arose from
 * accidental alignment is re-encoded back to the original bytes.
 */
export function reverseUtf8Corruption(buffer) {
  const src = new Uint8Array(buffer);
  const out = []; // number | UNKNOWN
  let i = 0;
  while (i < src.length) {
    const b0 = src[i];
    if (b0 < 0x80) {
      out.push(b0);
      i += 1;
    } else if (b0 >= 0xC2 && b0 <= 0xDF && i + 1 < src.length && (src[i + 1] & 0xC0) === 0x80) {
      // 2-byte UTF-8 → these two bytes WERE in the original file
      out.push(b0);
      out.push(src[i + 1]);
      i += 2;
    } else if (b0 >= 0xE0 && b0 <= 0xEF && i + 2 < src.length && (src[i + 1] & 0xC0) === 0x80 && (src[i + 2] & 0xC0) === 0x80) {
      const cp = ((b0 & 0x0F) << 12) | ((src[i + 1] & 0x3F) << 6) | (src[i + 2] & 0x3F);
      if (cp === 0xFFFD) {
        // Replacement character → one original byte was lost
        out.push(UNKNOWN);
      } else {
        // Genuine 3-byte sequence that was in the original binary
        out.push(b0);
        out.push(src[i + 1]);
        out.push(src[i + 2]);
      }
      i += 3;
    } else if (b0 >= 0xF0 && b0 <= 0xF4 && i + 3 < src.length && (src[i + 1] & 0xC0) === 0x80 && (src[i + 2] & 0xC0) === 0x80 && (src[i + 3] & 0xC0) === 0x80) {
      out.push(b0);
      out.push(src[i + 1]);
      out.push(src[i + 2]);
      out.push(src[i + 3]);
      i += 4;
    } else {
      // Stray byte that doesn't fit any UTF-8 pattern → treat as unknown
      out.push(UNKNOWN);
      i += 1;
    }
  }
  return out;
}

function reverseUtf8LegacyBytes(buffer) {
  const src = new Uint8Array(buffer);
  const out = [];
  let i = 0;
  while (i < src.length) {
    const b0 = src[i];
    if (b0 < 0x80) {
      out.push(b0);
      i += 1;
    } else if (b0 >= 0xC2 && b0 <= 0xDF && i + 1 < src.length && (src[i + 1] & 0xC0) === 0x80) {
      const cp = ((b0 & 0x1F) << 6) | (src[i + 1] & 0x3F);
      out.push(cp <= 0xFF ? cp : UNKNOWN);
      i += 2;
    } else if (b0 >= 0xE0 && b0 <= 0xEF && i + 2 < src.length && (src[i + 1] & 0xC0) === 0x80 && (src[i + 2] & 0xC0) === 0x80) {
      const cp = ((b0 & 0x0F) << 12) | ((src[i + 1] & 0x3F) << 6) | (src[i + 2] & 0x3F);
      out.push(cp <= 0xFF ? cp : UNKNOWN);
      i += 3;
    } else {
      out.push(UNKNOWN);
      i += 1;
    }
  }
  return out;
}

const CP1252_REVERSE = new Map([
  [0x20AC, 0x80],
  [0x201A, 0x82],
  [0x0192, 0x83],
  [0x201E, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02C6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8A],
  [0x2039, 0x8B],
  [0x0152, 0x8C],
  [0x017D, 0x8E],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201C, 0x93],
  [0x201D, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02DC, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9A],
  [0x203A, 0x9B],
  [0x0153, 0x9C],
  [0x017E, 0x9E],
  [0x0178, 0x9F]
]);

function reverseUtf8Windows1252(buffer) {
  const src = new Uint8Array(buffer);
  const out = [];
  let i = 0;
  while (i < src.length) {
    const b0 = src[i];
    if (b0 < 0x80) {
      out.push(b0);
      i += 1;
      continue;
    }

    let cp = null;
    let width = 1;
    if (b0 >= 0xC2 && b0 <= 0xDF && i + 1 < src.length && (src[i + 1] & 0xC0) === 0x80) {
      cp = ((b0 & 0x1F) << 6) | (src[i + 1] & 0x3F);
      width = 2;
    } else if (b0 >= 0xE0 && b0 <= 0xEF && i + 2 < src.length && (src[i + 1] & 0xC0) === 0x80 && (src[i + 2] & 0xC0) === 0x80) {
      cp = ((b0 & 0x0F) << 12) | ((src[i + 1] & 0x3F) << 6) | (src[i + 2] & 0x3F);
      width = 3;
    } else if (b0 >= 0xF0 && b0 <= 0xF4 && i + 3 < src.length && (src[i + 1] & 0xC0) === 0x80 && (src[i + 2] & 0xC0) === 0x80 && (src[i + 3] & 0xC0) === 0x80) {
      cp = ((b0 & 0x07) << 18) | ((src[i + 1] & 0x3F) << 12) | ((src[i + 2] & 0x3F) << 6) | (src[i + 3] & 0x3F);
      width = 4;
    }

    if (cp === null) {
      out.push(UNKNOWN);
      i += 1;
    } else if (cp === 0xFFFD) {
      out.push(UNKNOWN);
      i += width;
    } else if (cp <= 0x7F) {
      out.push(cp);
      i += width;
    } else if (cp >= 0xA0 && cp <= 0xFF) {
      out.push(cp);
      i += width;
    } else if (CP1252_REVERSE.has(cp)) {
      out.push(CP1252_REVERSE.get(cp));
      i += width;
    } else {
      out.push(UNKNOWN);
      i += width;
    }
  }
  return out;
}

function replacementSequenceCount(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let count = 0;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0xEF && bytes[i + 1] === 0xBF && bytes[i + 2] === 0xBD) count += 1;
  }
  return count;
}

// ─── Low-level binary reader over the recovered byte stream ─────────────────

class BinaryReader {
  constructor(bytes) {
    this.bytes = bytes; // number[] | UNKNOWN[]
    this.pos = 0;
  }

  remaining() { return this.bytes.length - this.pos; }

  readByte() {
    if (this.pos >= this.bytes.length) throw new Error('Unexpected end of stream');
    return this.bytes[this.pos++];
  }

  /** Read a little-endian WORD, returning {value, unknowns} */
  readWord() {
    const lo = this.readByte();
    const hi = this.readByte();
    const loKnown = lo !== UNKNOWN;
    const hiKnown = hi !== UNKNOWN;
    const value = ((hiKnown ? hi : 0) << 8) | (loKnown ? lo : 0);
    return { value, lo, hi, loKnown, hiKnown, fullyKnown: loKnown && hiKnown };
  }

  readWordValue() { return this.readWord().value; }

  /** Read a little-endian DWORD */
  readDword() {
    const b = [this.readByte(), this.readByte(), this.readByte(), this.readByte()];
    let value = 0;
    for (let i = 3; i >= 0; i--) value = (value << 8) | (b[i] === UNKNOWN ? 0 : b[i]);
    return value;
  }

  readInt() { return this.readDword() | 0; } // signed 32-bit

  readBool() {
    const b = this.readByte();
    return b === UNKNOWN ? false : b !== 0;
  }

  readFloat() {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    for (let i = 0; i < 4; i++) {
      const b = this.readByte();
      view.setUint8(i, b === UNKNOWN ? 0 : b);
    }
    const v = view.getFloat32(0, true);
    return Number.isFinite(v) ? v : 0;
  }

  readDouble() {
    const raw = [];
    for (let i = 0; i < 8; i++) raw.push(this.readByte());
    return reconstructDouble(raw);
  }

  readString(len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      const b = this.readByte();
      s += String.fromCharCode(b === UNKNOWN ? 0x3F : b); // '?' for unknowns
    }
    return s;
  }

  skip(n) { this.pos += n; }
}

// ─── MFC CArchive object-tracking reader ────────────────────────────────────

/**
 * MFC CArchive stores CObject* pointers with an identity-tracking scheme.
 * Classes and objects share one index counter.  Tags:
 *   0x0000  NULL
 *   0xFFFF  new class definition (schema + name follow, then object data)
 *   0x8000  big-class tag (DWORD class index follows) — rare
 *   tag|0x8000  class reference → new object of that class
 *   0x7FFF  big-object tag (DWORD object index follows)
 *   1..0x7FFE  object back-reference
 */
class MfcArchiveReader {
  constructor(bytes) {
    this.reader = new BinaryReader(bytes);
    this.mapCount = 1;   // shared class+object index counter (0 = NULL)
    this.classMap = {};  // index → { name, schema }
    this.objectMap = {};  // index → deserialized object (or placeholder)
    this.classNameToIndex = {}; // name → class index
  }

  /** Peek at the next tag without advancing the position. */
  peekTag() {
    const saved = this.reader.pos;
    const tag = this.reader.readWord();
    this.reader.pos = saved;
    return tag;
  }

  /**
   * Read an MFC object pointer.  `deserializer` is called with
   * (className, schema, reader) and must consume exactly the bytes
   * that Serialize() writes for that class.
   */
  readObject(deserializer) {
    const tag = this.reader.readWord();

    // NULL
    if (tag.fullyKnown && tag.value === 0) return null;

    // ── Fully known tag ──
    if (tag.fullyKnown) {
      if (tag.value === 0xFFFF) return this._readNewClass(deserializer);
      if ((tag.value & 0x8000) !== 0) {
        return this._readExistingClassNewObject(tag.value & 0x7FFF, deserializer);
      }
      if (tag.value === 0x7FFF) {
        return this.objectMap[this.reader.readDword()] ?? null;
      }
      return this.objectMap[tag.value] ?? null;
    }

    // ── Corrupted tag: lo known, hi unknown ──
    // Class reference: classIndex|0x8000 → lo is classIndex, hi was 0x80+
    if (tag.loKnown && !tag.hiKnown && this.classMap[tag.lo]) {
      return this._readExistingClassNewObject(tag.lo, deserializer);
    }

    // ── Corrupted tag: lo unknown, hi known ──
    if (!tag.loKnown && tag.hiKnown) {
      // hi === 0: object back-ref with index 128-255 (lo was 0x80-0xFF)
      // hi > 0 && hi < 0x80: object back-ref with index (hi<<8)+128..(hi<<8)+255
      if (tag.hi < 0x80) {
        const base = tag.hi << 8;
        // Try to find any matching object in the 128-wide range
        for (let lo = 0x80; lo <= 0xFF; lo++) {
          if (this.objectMap[base + lo]) return this.objectMap[base + lo];
        }
        return { _unresolved: true, indexRange: [base + 128, base + 255] };
      }
      // hi === 0x7F: big object tag (lo was 0xFF)
      if (tag.hi === 0x7F) {
        return this.objectMap[this.reader.readDword()] ?? null;
      }
    }

    // ── Both bytes unknown ──
    // After the initial class definition, new-class tags should not appear.
    // Two unknowns inside Nucleobase data means BOTH original bytes were
    // ≥0x80 — most likely a corrupted back-reference or position data
    // that leaked into a tag read (sync already compromised).
    if (!tag.loKnown && !tag.hiKnown) {
      // Peek: if next bytes look like a class definition (small ints
      // followed by ASCII), treat as new class; otherwise treat as
      // a lost object reference.
      const saved = this.reader.pos;
      const maybeSchema = this.reader.readWord();
      const maybeNameLen = this.reader.readWord();
      this.reader.pos = saved;
      if (maybeSchema.fullyKnown && maybeSchema.value <= 10 &&
          maybeNameLen.fullyKnown && maybeNameLen.value > 0 && maybeNameLen.value < 64) {
        return this._readNewClass(deserializer);
      }
      // Not a class definition — treat as unresolvable back-reference
      return { _unresolved: true, indexRange: [32896, 65535] };
    }

    // ── Remaining: lo known, hi unknown but lo not a known class ──
    // Likely a class reference to an index we don't recognize, or
    // an object reference with index = lo, hi was 0x80+ (i.e., index
    // is actually lo | (original_hi << 8) with high bit set = class ref).
    // Best guess: treat lo as a class index if any class is close.
    if (tag.loKnown) {
      for (let ci = tag.lo; ci >= 1; ci--) {
        if (this.classMap[ci]) {
          return this._readExistingClassNewObject(ci, deserializer);
        }
      }
    }
    return { _unresolved: true };
  }

  _readNewClass(deserializer) {
    const schema = this.reader.readWordValue();
    const nameLen = this.reader.readWordValue();
    const name = this.reader.readString(nameLen);
    const classIndex = this.mapCount++;
    this.classMap[classIndex] = { name, schema };
    this.classNameToIndex[name] = classIndex;
    // MFC registers the object BEFORE calling Serialize(), so that
    // back-references from nested objects resolve correctly.
    const objIndex = this.mapCount++;
    const placeholder = { _archiveIndex: objIndex };
    this.objectMap[objIndex] = placeholder;
    const obj = deserializer(name, schema, this.reader, this, placeholder);
    Object.assign(placeholder, obj);
    return placeholder;
  }

  _readExistingClassNewObject(classIndex, deserializer) {
    const classInfo = this.classMap[classIndex];
    if (!classInfo) {
      for (let ci = classIndex; ci >= 1; ci--) {
        if (this.classMap[ci]) {
          const objIndex = this.mapCount++;
          const placeholder = { _archiveIndex: objIndex };
          this.objectMap[objIndex] = placeholder;
          const obj = deserializer(this.classMap[ci].name, this.classMap[ci].schema, this.reader, this, placeholder);
          Object.assign(placeholder, obj);
          return placeholder;
        }
      }
      throw new Error(`Unknown class index ${classIndex} at position ${this.reader.pos}`);
    }
    const objIndex = this.mapCount++;
    const placeholder = { _archiveIndex: objIndex };
    this.objectMap[objIndex] = placeholder;
    const obj = deserializer(classInfo.name, classInfo.schema, this.reader, this, placeholder);
    Object.assign(placeholder, obj);
    return placeholder;
  }
}

// ─── Tiamat type mappings ───────────────────────────────────────────────────

const BASE_TYPE_MAP = ['A', 'T', 'U', 'C', 'G', 'X'];
const GEOMETRY_MAP = ['A', 'B', 'Free'];

function baseTypeToChar(typeInt, schema) {
  let t = typeInt;
  if (schema <= 3 && t > 1) t++; // schema ≤3 had no Uracil slot
  return BASE_TYPE_MAP[t] ?? 'X';
}

function geometryToName(geoInt) {
  return GEOMETRY_MAP[geoInt] ?? 'Free';
}

// ─── Deserializers for each MFC class ───────────────────────────────────────

function deserializeView(name, schema, reader) {
  if (name === 'CPerspective') {
    // COpenGLWnd::Serialize → nothing
    // CPerspective: float zoom, double c.a/b/c, double prev_quat(w,vx,vy,vz), double draw_quat(w,vx,vy,vz)
    const zoom = reader.readFloat();
    const cx = reader.readDouble();
    const cy = reader.readDouble();
    const cz = reader.readDouble();
    const pw = reader.readDouble();
    const pvx = reader.readDouble();
    const pvy = reader.readDouble();
    const pvz = reader.readDouble();
    const dw = reader.readDouble();
    const dvx = reader.readDouble();
    const dvy = reader.readDouble();
    const dvz = reader.readDouble();
    return { type: name, zoom, center: { x: cx, y: cy, z: cz }, drawQuat: { w: dw, vx: dvx, vy: dvy, vz: dvz } };
  }
  // CTop, CSide, CFront → COrthographic: float zoom, float xpos, float ypos
  const zoom = reader.readFloat();
  const xpos = reader.readFloat();
  const ypos = reader.readFloat();
  return { type: name, zoom, xpos, ypos };
}

/**
 * Iterative nucleobase deserializer.  MFC serialises pointer chains
 * depth-first, which can create recursion as deep as the longest strand
 * (thousands of bases).  We use an explicit work-stack instead.
 *
 * Each stack frame represents one base mid-deserialization.  The `step`
 * field tracks which field to read next:
 *   0 = isAcross   1 = isDown   2 = isUp   3 = position+type+tail
 *
 * When a pointer leads to a NEW object, we push the current frame back
 * (with step incremented) and push a new frame for the child object.
 */

// Steps
const S_ACROSS = 0;
const S_DOWN = 1;
const S_UP = 2;
const S_DATA = 3;
const S_SLIDES = 4;
const S_STICKY = 5;
const S_DONE = 6;

function readNucleobaseFields(base, step, schema, reader, archive, stack) {
  // Returns true when all fields are read; false when paused for a child object.
  while (step < S_DONE) {
    if (step === S_ACROSS) {
      base.isAcross = reader.readBool();
      if (base.isAcross) {
        const obj = readObjectInline(archive, stack, base, S_DOWN, schema);
        if (obj === DEFERRED) return false;  // child pushed onto stack
        base._acrossObj = obj;
      } else {
        base._acrossObj = null;
      }
      step = S_DOWN;
    }
    if (step === S_DOWN) {
      base.isDown = reader.readBool();
      if (base.isDown) {
        const obj = readObjectInline(archive, stack, base, S_UP, schema);
        if (obj === DEFERRED) return false;
        base._downObj = obj;
      } else {
        base._downObj = null;
      }
      step = S_UP;
    }
    if (step === S_UP) {
      base.isUp = reader.readBool();
      if (base.isUp) {
        const obj = readObjectInline(archive, stack, base, S_DATA, schema);
        if (obj === DEFERRED) return false;
        base._upObj = obj;
      } else {
        base._upObj = null;
      }
      step = S_DATA;
    }
    if (step === S_DATA) {
      if (archive._corruptedStream) {
        const width = archive._floatPositions ? 4 : 8;
        reader.skip(width * 3);
        base.px = 0;
        base.py = 0;
        base.pz = 0;
      } else if (archive._floatPositions) {
        base.px = reader.readFloat();
        base.py = reader.readFloat();
        base.pz = reader.readFloat();
      } else {
        base.px = reader.readDouble();
        base.py = reader.readDouble();
        base.pz = reader.readDouble();
      }
      const rawType = reader.readInt();
      base.type = baseTypeToChar(rawType, schema);
      if (schema > 1 && !archive._schema3NoColor) {
        base.useStrandColor = reader.readBool();
        base.strandColorR = reader.readFloat();
        base.strandColorG = reader.readFloat();
        base.strandColorB = reader.readFloat();
        base._slideCount = archive._schema3NoSlides ? 0 : reader.readInt();
        if (base._slideCount < 0 || base._slideCount > 64 || base._slideCount > (archive._expectedBaseCount ?? 100000)) {
          base._slideCount = 0;
        }
        base._slideObjs = [];
      } else {
        base.useStrandColor = false;
        base.strandColorR = 0;
        base.strandColorG = 0;
        base.strandColorB = 0;
        base._slideCount = 0;
        base._slideObjs = [];
      }
      step = (schema > 1 && base._slideCount > 0) ? S_SLIDES : S_STICKY;
    }
    if (step === S_SLIDES) {
      while (base._slideObjs.length < (base._slideCount ?? 0)) {
        const obj = readObjectInline(archive, stack, base, S_SLIDES, schema);
        if (obj === DEFERRED) return false;
        base._slideObjs.push(obj);
      }
      step = S_STICKY;
    }
    if (step === S_STICKY) {
      if (schema > 2 && archive._schema3StickyIdOnly) {
        base.stickyID = reader.readInt();
        base._stickyObj = null;
      } else if (schema > 2 && !archive._schema3NoSticky) {
        base.stickyID = reader.readInt();
        const obj = readObjectInline(archive, stack, base, S_DONE, schema);
        if (obj === DEFERRED) return false;
        base._stickyObj = obj;
      } else {
        base.stickyID = 0;
        base._stickyObj = null;
      }
      if (schema > 3) base.isRNA = reader.readBool(); else base.isRNA = false;
      if (schema > 4) base.geometry = geometryToName(reader.readInt());
      else if (schema < 3) base.geometry = 'B';
      else base.geometry = 'Free';
      step = S_DONE;
    }
  }
  return true;
}

const DEFERRED = Symbol('deferred');

/**
 * Read an MFC object pointer.  If the pointer leads to a new Nucleobase
 * that needs deserialization, push the current base's continuation and
 * a new frame for the child onto `stack`, and return DEFERRED.
 */
function readObjectInline(archive, stack, parentBase, resumeStep, schema) {
  const tag = archive.reader.readWord();

  // NULL
  if (tag.fullyKnown && tag.value === 0) return null;

  // ── Fully known tag ──
  if (tag.fullyKnown) {
    if (tag.value === 0xFFFF) {
      return startChildBase(archive, stack, parentBase, resumeStep, schema, true);
    }
    if ((tag.value & 0x8000) !== 0) {
      const ci = tag.value & 0x7FFF;
      if (archive.classMap[ci]) {
        return startChildBase(archive, stack, parentBase, resumeStep, archive.classMap[ci].schema, false);
      }
    }
    if (tag.value === 0x7FFF) return archive.objectMap[archive.reader.readDword()] ?? null;
    return archive.objectMap[tag.value] ?? null;
  }

  // ── lo known, hi unknown → class reference ──
  if (tag.loKnown && !tag.hiKnown && archive.classMap[tag.lo]) {
    return startChildBase(archive, stack, parentBase, resumeStep, archive.classMap[tag.lo].schema, false);
  }

  // ── lo unknown, hi known → object back-ref ──
  if (!tag.loKnown && tag.hiKnown) {
    if (tag.hi < 0x80) {
      const base = tag.hi << 8;
      for (let lo = 0x80; lo <= 0xFF; lo++) {
        if (archive.objectMap[base + lo]) return archive.objectMap[base + lo];
      }
      return { _unresolved: true };
    }
    if (tag.hi === 0x7F) return archive.objectMap[archive.reader.readDword()] ?? null;
  }

  // ── Both unknown → check if new class ──
  if (!tag.loKnown && !tag.hiKnown) {
    const saved = archive.reader.pos;
    const s = archive.reader.readWord();
    const n = archive.reader.readWord();
    archive.reader.pos = saved;
    if (s.fullyKnown && s.value <= 10 && n.fullyKnown && n.value > 0 && n.value < 64) {
      return startChildBase(archive, stack, parentBase, resumeStep, schema, true);
    }
    return { _unresolved: true };
  }

  // ── lo known, hi unknown, lo not a known class → must be a back-ref ──
  // If hi was <0x80 it would survive corruption, so hi was ≥0x80 → class-ref bit.
  // But no class exists at this index, so the tag is unresolvable.
  return { _unresolved: true };
}

function startChildBase(archive, stack, parentBase, resumeStep, schema, isNewClass) {
  // Don't create more objects than expected — corruption can cause
  // back-refs to be misread as class-refs, spawning phantom objects.
  if (archive._maxObjects > 0 && (archive._objectCount ?? Object.keys(archive.objectMap).length) >= archive._maxObjects) {
    return { _unresolved: true };
  }
  // Structural validation: the first byte of a Nucleobase body is isAcross
  // (a bool: 0 or 1).  If the next byte isn't 0 or 1, this tag was a
  // misidentified back-reference — don't consume body bytes.
  if (!isNewClass) {
    const peek = archive.reader.bytes[archive.reader.pos];
    if (peek !== 0 && peek !== 1) return { _unresolved: true };
  }
  if (isNewClass) {
    const s = archive.reader.readWordValue();
    const nl = archive.reader.readWordValue();
    const name = archive.reader.readString(nl);
    const classIndex = archive.mapCount++;
    archive.classMap[classIndex] = { name, schema: s };
    schema = s;
  }
  const objIndex = archive.mapCount++;
  const child = { _archiveIndex: objIndex };
  archive.objectMap[objIndex] = child;
  archive._objectCount = (archive._objectCount ?? 0) + 1;
  archive._nucleobaseCount = (archive._nucleobaseCount ?? 0) + 1;

  stack.push({ base: parentBase, step: resumeStep, schema: schema, childResult: child });
  stack.push({ base: child, step: S_ACROSS, schema });
  return DEFERRED;
}

/**
 * Iteratively deserialize all nucleobases from the archive stream.
 * This replaces the recursive deserializeNucleobase approach.
 */
function deserializeAllNucleobases(archive, baseCount, schema) {
  const reader = archive.reader;
  const stack = []; // explicit work stack
  const baseIndexStart = archive.mapCount; // first Nucleobase object index

  // Count of Nucleobase objects actually created (not back-refs).
  // Once this hits baseCount, every remaining outer-loop tag MUST be
  // a back-reference (2 bytes, no body).  Corrupted tags that look
  // like class-refs should be skipped, not deserialized.
  const nucleobaseCount = () => {
    let n = 0;
    for (const k in archive.objectMap) {
      if (archive.objectMap[k]?.type !== undefined || archive.objectMap[k]?.isAcross !== undefined) n++;
    }
    return n;
  };

  try {
    for (let i = 0; i < baseCount; i++) {
      if (reader.remaining() < 2) break;

      const tag = reader.readWord();

      // NULL
      if (tag.fullyKnown && tag.value === 0) continue;

      // Back-reference (fully known, no class bit, not big-object)
      if (tag.fullyKnown && tag.value > 0 && tag.value < 0x7FFF && (tag.value & 0x8000) === 0) continue;
      if (tag.fullyKnown && tag.value === 0x7FFF) { reader.readDword(); continue; }

      // Corrupted back-reference: lo unknown + hi known (hi < 0x80)
      if (!tag.loKnown && tag.hiKnown && tag.hi >= 0 && tag.hi < 0x80) continue;

      // If we've already deserialized all expected bases, every remaining
      // tag should be a back-ref.  Skip anything that isn't clearly one.
      if (Object.keys(archive.objectMap).length >= baseCount + 10) continue;

      let baseSchema = schema;
      const isNewClass = (!tag.loKnown && !tag.hiKnown) || (tag.fullyKnown && tag.value === 0xFFFF);
      const isClassRef = (tag.loKnown && !tag.hiKnown && archive.classMap[tag.lo]) ||
                         (tag.fullyKnown && (tag.value & 0x8000) !== 0 && tag.value !== 0xFFFF);

      if (isNewClass) {
        const saved = reader.pos;
        const ms = reader.readWord();
        const mn = reader.readWord();
        reader.pos = saved;
        if (!ms.fullyKnown || ms.value > 10 || !mn.fullyKnown || mn.value === 0 || mn.value > 63) continue;
        const s = reader.readWordValue();
        const nl = reader.readWordValue();
        reader.readString(nl);
        const ci = archive.mapCount++;
        archive.classMap[ci] = { name: 'Nucleobase', schema: s };
        baseSchema = s;
      } else if (!isClassRef) {
        continue;
      }

      const objIndex = archive.mapCount++;
      const base = { _archiveIndex: objIndex };
      archive.objectMap[objIndex] = base;
      stack.push({ base, step: S_ACROSS, schema: baseSchema });

      while (stack.length > 0) {
        const frame = stack.pop();
        if (frame.childResult !== undefined) {
          assignChildResult(frame.base, frame.step, frame.childResult);
          stack.push({ base: frame.base, step: frame.step, schema: frame.schema });
          continue;
        }
        readNucleobaseFields(frame.base, frame.step, frame.schema, reader, archive, stack);
      }
    }
  } catch {
    // End of stream or unrecoverable corruption — return what we have
  }
}

function assignChildResult(base, resumeStep, child) {
  // The child was the result of the pointer read BEFORE resumeStep
  if (resumeStep === S_DOWN) base._acrossObj = child;
  else if (resumeStep === S_UP) base._downObj = child;
  else if (resumeStep === S_DATA) base._upObj = child;
  else if (resumeStep === S_SLIDES) {
    if (!base._slideObjs) base._slideObjs = [];
    base._slideObjs.push(child);
  }
  else if (resumeStep === S_DONE) base._stickyObj = child;
}

// ─── Resolve MFC object pointers to Tiamat-Web base IDs ────────────────────

function resolvePointer(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'object' && '_archiveIndex' in obj) return obj._archiveIndex;
  return null;
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Parse a raw Tiamat .dna binary file.
 * Returns { view, bases, diagnostics } compatible with Tiamat-Web's
 * model.loadBases() and scene.restoreView().
 *
 * Strategy: skip view-pane objects by scanning for the "Nucleobase" class
 * definition as an anchor, then parse the real MFC object graph from there.
 */
export function parseDnaFile(arrayBuffer) {
  const replacementSequences = replacementSequenceCount(arrayBuffer);
  const attempts = [
    { bytes: [...new Uint8Array(arrayBuffer)], recovery: 'raw binary', corrupted: false }
  ];
  if (replacementSequences > 0) {
    attempts.push({
      bytes: reverseUtf8Corruption(arrayBuffer),
      recovery: 'UTF-8 replacement recovery (schema 3 no-color)',
      corrupted: true,
      schema3NoColor: true
    }, {
      bytes: reverseUtf8Corruption(arrayBuffer),
      recovery: 'UTF-8 replacement recovery',
      corrupted: true
    }, {
      bytes: reverseUtf8Corruption(arrayBuffer),
      recovery: 'UTF-8 replacement recovery (schema 3 no-sticky)',
      corrupted: true,
      schema3NoSticky: true
    }, {
      bytes: reverseUtf8Corruption(arrayBuffer),
      recovery: 'UTF-8 replacement recovery (float positions, schema 3 no-sticky)',
      corrupted: true,
      floatPositions: true,
      schema3NoSticky: true
    }, {
      bytes: reverseUtf8Corruption(arrayBuffer),
      recovery: 'UTF-8 replacement recovery (schema 3 no-slides)',
      corrupted: true,
      schema3NoSlides: true
    }, {
      bytes: reverseUtf8LegacyBytes(arrayBuffer),
      recovery: 'UTF-8 legacy byte recovery',
      corrupted: true
    }, {
      bytes: reverseUtf8Windows1252(arrayBuffer),
      recovery: 'Windows-1252 text recovery',
      corrupted: true
    });
  }

  const errors = [];
  const recoverable = [];
  for (const attempt of attempts) {
    const parsed = parseDnaBytes(attempt.bytes, attempt);
    if (parsed.ok) {
      if (parsed.provisional) {
        const d = parsed.data.diagnostics;
        const recoveredFraction = (d.recoveredBases ?? d.importedBases ?? 0) / (d.expectedBases ?? 1);
        if (!d.partial || recoveredFraction >= 0.98 || (d.expectedBases >= 5000 && recoveredFraction >= 0.7)) {
          parsed.data.diagnostics.replacementSequences = replacementSequences;
          return parsed.data;
        }
        recoverable.push(parsed);
        continue;
      }
      parsed.data.diagnostics.replacementSequences = replacementSequences;
      return parsed.data;
    }
    errors.push(parsed.error);
  }
  if (recoverable.length > 0) {
    recoverable.sort((a, b) => b.score - a.score);
    const best = recoverable[0].data;
    best.diagnostics.replacementSequences = replacementSequences;
    return best;
  }
  throw new Error(errors.at(-1) ?? 'Could not parse Tiamat .dna object graph');
}

function parseDnaBytes(bytes, attempt) {
  const anchor = findString(bytes, 'Nucleobase');
  if (anchor === -1) return { ok: false, error: 'Could not find Nucleobase class definition in .dna file' };
  const tagOffset = anchor - 6;
  const baseCount = readDwordAt(bytes, tagOffset - 4);
  const schema = readWordAt(bytes, anchor - 4);
  if (baseCount <= 0 || baseCount > 100000 || schema <= 0 || schema > 10) {
    return { ok: false, error: `Invalid Tiamat object graph header: ${baseCount} bases, schema ${schema}` };
  }
  const dataStart = anchor + 10; // byte after "Nucleobase" class name
  const graphParse = parseNucleobaseGraph(bytes, dataStart, baseCount, schema, attempt);
  const coordinateQuality = coordinateRecoveryQuality(graphParse.bases);
  if (graphParse.bases.length === baseCount) {
    if (attempt.corrupted && coordinateQuality < 0.9) {
      rebuildLegacyCoordinates(graphParse.bases);
      graphParse.diagnostics.coordinateLayoutRebuilt = true;
    }
    graphParse.diagnostics.recovery = attempt.recovery;
    graphParse.diagnostics.corrupted = attempt.corrupted;
    graphParse.diagnostics.partial = false;
    graphParse.diagnostics.coordinateQuality = coordinateQuality;
    return {
      ok: true,
      data: graphParse,
      provisional: attempt.corrupted && coordinateQuality < 0.9,
      score: 2 + coordinateQuality
    };
  }

  const recoveredFraction = graphParse.bases.length / baseCount;
  if (attempt.corrupted && recoveredFraction >= 0.5) {
    const recoveredBases = graphParse.bases.length;
    synthesizeMissingBases(graphParse.bases, baseCount, schema);
    rebuildLegacyCoordinates(graphParse.bases);
    graphParse.diagnostics.recovery = attempt.recovery;
    graphParse.diagnostics.corrupted = true;
    graphParse.diagnostics.partial = true;
    graphParse.diagnostics.importedBases = graphParse.bases.length;
    graphParse.diagnostics.recoveredBases = recoveredBases;
    graphParse.diagnostics.synthesizedBases = baseCount - recoveredBases;
    graphParse.diagnostics.coordinateQuality = coordinateQuality;
    graphParse.diagnostics.coordinateLayoutRebuilt = true;
    graphParse.diagnostics.strands = countParsedStrands(graphParse.bases);
    graphParse.diagnostics.pairs = countPairs(graphParse.bases);
    return {
      ok: true,
      data: graphParse,
      provisional: true,
      score: recoveredFraction + coordinateQuality * 0.2
    };
  }
  return {
    ok: false,
    error: `Could not parse Tiamat .dna object graph: read ${graphParse.bases.length} of ${baseCount} bases${attempt.corrupted ? '; file contains UTF-8 replacement bytes, so exact binary coordinates may be unrecoverable' : ''}${graphParse.diagnostics.parseError ? ` (${graphParse.diagnostics.parseError} at ${graphParse.diagnostics.parseOffset})` : ''}`
  };
}

function synthesizeMissingBases(bases, baseCount, schema) {
  for (let id = bases.length; id < baseCount; id++) {
    bases.push({
      id,
      type: 'X',
      molecule: schema > 3 ? 'DNA' : 'DNA',
      geometry: schema < 3 ? 'B' : 'Free',
      position: { x: 0, y: 0, z: 0 },
      up: null,
      down: null,
      across: null,
      slide: [],
      sticky: null,
      stickyID: 0,
      strand: 0,
      circular: false,
      top: false,
      preset: false,
      temp: false,
      useStrandColor: false,
      strandColor: null,
      constraints: {}
    });
  }
}

function rebuildLegacyCoordinates(bases) {
  const strands = orderedStrands(bases);
  const positions = new Map();
  const rowSpacing = 2.4;
  const rise = 0.68;
  const pairOffset = 1.15;

  if (strands.length > bases.length / 4) {
    const columns = Math.ceil(Math.sqrt(bases.length));
    bases.forEach((base, index) => {
      positions.set(base.id, {
        x: (index % columns) * rise,
        y: Math.floor(index / columns) * rise,
        z: 0
      });
    });
  } else {
    strands.forEach((strand, row) => {
      strand.forEach((base, column) => {
        if (positions.has(base.id)) return;
        positions.set(base.id, {
          x: column * rise,
          y: row * rowSpacing,
          z: 0
        });
      });
    });

    bases.forEach((base) => {
      if (positions.has(base.id)) return;
      positions.set(base.id, {
        x: (base.id % 96) * rise,
        y: (Math.floor(base.id / 96) + strands.length) * rowSpacing,
        z: 0
      });
    });
  }

  bases.forEach((base) => {
    if (base.across === null || !bases[base.across]) return;
    const here = positions.get(base.id);
    const paired = positions.get(base.across);
    if (!here || !paired) return;
    if (base.id < base.across) {
      paired.x = here.x;
      paired.y = here.y + pairOffset;
      paired.z = here.z;
    }
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  positions.forEach((pos) => {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y);
  });
  const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
  const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
  bases.forEach((base) => {
    const pos = positions.get(base.id) ?? { x: 0, y: 0, z: 0 };
    base.position = { x: pos.x - cx, y: pos.y - cy, z: pos.z };
  });
}

function orderedStrands(bases) {
  const visited = new Set();
  const strands = [];
  const byId = new Map(bases.map((base) => [base.id, base]));
  const walk = (start) => {
    const strand = [];
    let current = start;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      strand.push(current);
      current = current.down === null ? null : byId.get(current.down);
    }
    return strand;
  };

  bases.forEach((base) => {
    if (base.up === null && !visited.has(base.id)) {
      const strand = walk(base);
      if (strand.length) strands.push(strand);
    }
  });
  bases.forEach((base) => {
    if (!visited.has(base.id)) {
      const strand = walk(base);
      if (strand.length) strands.push(strand);
    }
  });
  return strands;
}

function coordinateRecoveryQuality(bases) {
  if (!bases.length) return 0;
  let plausible = 0;
  bases.forEach((base) => {
    const { x, y, z } = base.position;
    const length = Math.hypot(x, y, z);
    if (Number.isFinite(length) &&
        length > 0.0001 &&
        Math.abs(x) < 500 &&
        Math.abs(y) < 500 &&
        Math.abs(z) < 500) {
      plausible += 1;
    }
  });
  return plausible / bases.length;
}

function countParsedStrands(bases) {
  const byId = new Map(bases.map((base) => [base.id, base]));
  const visited = new Set();
  let strands = 0;
  const walk = (base) => {
    let current = base;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      current = current.down === null ? null : byId.get(current.down);
    }
  };
  bases.filter((base) => base.up === null).forEach((base) => {
    strands += 1;
    walk(base);
  });
  bases.forEach((base) => {
    if (visited.has(base.id)) return;
    strands += 1;
    walk(base);
  });
  return strands;
}

function rawPosition(x, y, z) {
  return {
    x: safeNum(x),
    y: safeNum(y),
    z: safeNum(z)
  };
}

function parseNucleobaseGraph(bytes, dataStart, baseCount, schema, attempt = {}) {
  const archive = new MfcArchiveReader(bytes);
  archive.reader.pos = dataStart;
  archive.mapCount = 10;
  archive.classMap[9] = { name: 'Nucleobase', schema };
  archive.classNameToIndex.Nucleobase = 9;
  archive._maxObjects = baseCount + 8;
  archive._expectedBaseCount = baseCount;
  archive._corruptedStream = Boolean(attempt.corrupted);
  archive._schema3NoSticky = Boolean(attempt.schema3NoSticky) && schema === 3;
  archive._schema3StickyIdOnly = Boolean(attempt.schema3StickyIdOnly) && schema === 3;
  archive._schema3NoColor = Boolean(attempt.schema3NoColor) && schema === 3;
  archive._schema3NoSlides = Boolean(attempt.schema3NoSlides) && schema === 3;
  archive._floatPositions = Boolean(attempt.floatPositions);

  const first = { _archiveIndex: 10 };
  archive.objectMap[10] = first;
  archive._objectCount = 1;
  archive._nucleobaseCount = 1;
  archive.mapCount = 11;

  const stack = [{ base: first, step: S_ACROSS, schema }];
  try {
    drainNucleobaseStack(stack, archive);

    while ((archive._nucleobaseCount ?? countNucleobaseObjects(archive)) < baseCount && archive.reader.remaining() >= 2) {
      const before = archive.reader.pos;
      const obj = readObjectInline(archive, stack, null, S_DONE, schema);
      if (obj === DEFERRED) drainNucleobaseStack(stack, archive);
      if (archive.reader.pos === before) archive.reader.skip(2);
    }
  } catch (error) {
    archive._parseError = error;
    // Return the partial parse; the caller rejects incomplete object graphs.
  }

  const objects = Object.values(archive.objectMap)
    .filter((obj) => obj && obj.type !== undefined && Number.isFinite(obj.px) && Number.isFinite(obj.py) && Number.isFinite(obj.pz))
    .sort((a, b) => a._archiveIndex - b._archiveIndex)
    .slice(0, baseCount);

  if (objects.length === 0) {
    return { view: null, bases: [], diagnostics: { importedBases: 0 } };
  }

  const idByArchiveIndex = new Map(objects.map((obj, id) => [obj._archiveIndex, id]));
  const pointerId = (obj) => {
    const archiveIndex = resolvePointer(obj);
    return archiveIndex === null ? null : idByArchiveIndex.get(archiveIndex) ?? null;
  };

  const bases = objects.map((obj, id) => {
    const strandColor = obj.useStrandColor
      ? rgbToHex(obj.strandColorR, obj.strandColorG, obj.strandColorB)
      : null;
    return {
      id,
      type: obj.type ?? 'X',
      molecule: obj.isRNA ? 'RNA' : 'DNA',
      geometry: obj.geometry ?? (schema < 3 ? 'B' : 'Free'),
      position: rawPosition(obj.px, obj.py, obj.pz),
      up: obj.isUp ? pointerId(obj._upObj) : null,
      down: obj.isDown ? pointerId(obj._downObj) : null,
      across: obj.isAcross ? pointerId(obj._acrossObj) : null,
      slide: (obj._slideObjs ?? []).map(pointerId).filter((value) => value !== null),
      sticky: pointerId(obj._stickyObj),
      stickyID: obj.stickyID ?? 0,
      strand: 0,
      circular: false,
      top: false,
      preset: (obj.type ?? 'X') !== 'X',
      temp: false,
      useStrandColor: Boolean(obj.useStrandColor),
      strandColor,
      constraints: {}
    };
  });

  repairReciprocalLinks(bases, 'up', 'down');
  repairReciprocalLinks(bases, 'down', 'up');
  repairReciprocalLinks(bases, 'across', 'across');
  const strands = countParsedStrands(bases);

  return {
    view: null,
    bases,
    diagnostics: {
      format: 'Tiamat .dna (MFC object graph)',
      importedBases: bases.length,
      expectedBases: baseCount,
      schema,
      strands,
      pairs: countPairs(bases),
      corrupted: false,
      parseError: archive._parseError?.message,
      parseOffset: archive.reader.pos
    }
  };
}

function drainNucleobaseStack(stack, archive) {
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame.base) continue;
    if (frame.childResult !== undefined) {
      assignChildResult(frame.base, frame.step, frame.childResult);
      stack.push({ base: frame.base, step: frame.step, schema: frame.schema });
      continue;
    }
    readNucleobaseFields(frame.base, frame.step, frame.schema, archive.reader, archive, stack);
  }
}

function countNucleobaseObjects(archive) {
  let count = 0;
  for (const obj of Object.values(archive.objectMap)) {
    if (obj?.type !== undefined || obj?.isAcross !== undefined) count++;
  }
  return count;
}

function countPairs(bases) {
  const seen = new Set();
  let pairs = 0;
  bases.forEach((base) => {
    if (base.across === null || !bases[base.across]) return;
    const a = Math.min(base.id, base.across);
    const b = Math.max(base.id, base.across);
    const key = `${a}:${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs += 1;
  });
  return pairs;
}

function repairReciprocalLinks(bases, key, reciprocalKey) {
  bases.forEach((base) => {
    const target = bases[base[key]];
    if (!target || target[reciprocalKey] === base.id) return;
    if (target[reciprocalKey] === null) target[reciprocalKey] = base.id;
  });
}

function readDoubleAt(bytes, offset) {
  const raw = [];
  for (let i = 0; i < 8; i++) raw.push(bytes[offset + i]);
  return reconstructDouble(raw);
}

/** Deserializer that only handles Nucleobase (ignores view classes). */
function nucleobaseOnlyDeserializer(name, schema, reader, archive, placeholder) {
  return deserializeNucleobase(name, schema, reader, archive, placeholder);
}

function findString(bytes, str) {
  const needle = str.split('').map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i < bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function readWordAt(bytes, offset) {
  const lo = bytes[offset] === UNKNOWN ? 0 : bytes[offset];
  const hi = bytes[offset + 1] === UNKNOWN ? 0 : bytes[offset + 1];
  return (hi << 8) | lo;
}

function readDwordAt(bytes, offset) {
  let value = 0;
  for (let i = 3; i >= 0; i--) {
    const b = bytes[offset + i];
    value = (value << 8) | (b === UNKNOWN ? 0 : b);
  }
  return value;
}

function safeNum(v) {
  if (!Number.isFinite(v)) return 0;
  // DNA nanostructure coordinates are typically within ±200 nm.
  // Values beyond this are reconstruction artifacts from corrupted exponent bytes.
  if (v > 200 || v < -200) return 0;
  return v;
}

/**
 * Reconstruct an IEEE 754 double from 8 bytes where some may be UNKNOWN.
 * Strategy: fill unknown bytes to produce a value in [-200, 200] (Tiamat nm range).
 *
 * IEEE 754 LE layout:  bytes[0..5] = mantissa, bytes[6] = exp_lo|mantissa_hi,
 * bytes[7] = sign(1) | exponent_hi(7).
 *
 * For values in [-200, 200], the exponent (biased) is 0x3FF..0x406 for
 * magnitudes 1..128, so byte 7 is typically 0x40 (positive) or 0xC0 (negative).
 * Byte 6 is typically 0x00..0x69 for these ranges.
 */
function reconstructDouble(raw) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);

  // Count unknowns
  let unknowns = 0;
  for (let i = 0; i < 8; i++) {
    if (raw[i] === UNKNOWN) unknowns++;
    else view.setUint8(i, raw[i]);
  }
  if (unknowns === 0) {
    const v = view.getFloat64(0, true);
    return Number.isFinite(v) ? v : 0;
  }
  if (unknowns >= 7) return 0; // too corrupted

  const candidate = reconstructDoubleBySearch(raw);
  if (candidate !== null) return candidate;

  // byte 7 (MSB): sign + exponent high bits
  // byte 6: exponent low bits + mantissa high bits
  const b7known = raw[7] !== UNKNOWN;
  const b6known = raw[6] !== UNKNOWN;

  if (b7known && b6known) {
    // Both exponent bytes known — just zero-fill mantissa unknowns
    for (let i = 0; i < 6; i++) {
      if (raw[i] === UNKNOWN) view.setUint8(i, 0);
    }
    const v = view.getFloat64(0, true);
    return Number.isFinite(v) && Math.abs(v) < 10000 ? v : 0;
  }

  // For remaining cases with unknown exponent bytes: use byte 7's known
  // exponent high bits (if available) to constrain byte 6, or try common
  // byte 7 values.  Zero-fill mantissa unknowns — this loses precision
  // but preserves the correct magnitude and sign.
  for (let i = 0; i < 6; i++) {
    if (raw[i] === UNKNOWN) view.setUint8(i, 0);
  }

  if (b7known && !b6known) {
    // byte 7 known → we know sign + exponent high bits.
    // Set byte 6 to 0x00 — gives the LOWEST exponent consistent with byte 7,
    // which is the most conservative estimate.
    view.setUint8(6, 0x00);
    view.setUint8(7, raw[7]);
    const v = view.getFloat64(0, true);
    return Number.isFinite(v) && Math.abs(v) < 10000 ? v : 0;
  }

  if (!b7known && b6known) {
    // byte 7 unknown — try both signs with the exponent that byte 6 implies.
    view.setUint8(6, raw[6]);
    // Try 0x40 (positive, exp ~2-128) and 0xC0 (negative, same magnitude)
    // then 0x3F/0xBF for smaller values
    for (const b7 of [0x40, 0xC0, 0x3F, 0xBF, 0x41, 0xC1]) {
      view.setUint8(7, b7);
      const v = view.getFloat64(0, true);
      if (Number.isFinite(v) && Math.abs(v) > 0.001 && Math.abs(v) < 10000) return v;
    }
    return 0;
  }

  // Both unknown — try common DNA-scale exponents
  for (const [b7, b6] of [[0x40, 0x50], [0xC0, 0x50], [0x40, 0x00], [0xC0, 0x00], [0x3F, 0xF0], [0xBF, 0xF0]]) {
    view.setUint8(6, b6);
    view.setUint8(7, b7);
    const v = view.getFloat64(0, true);
    if (Number.isFinite(v) && Math.abs(v) > 0.001 && Math.abs(v) < 10000) return v;
  }
  return 0;
}

function reconstructDoubleBySearch(raw) {
  const b6Values = raw[6] === UNKNOWN
    ? [...Array.from({ length: 128 }, (_, i) => 0x80 + i), ...Array.from({ length: 128 }, (_, i) => i)]
    : [raw[6]];
  const b7Values = raw[7] === UNKNOWN
    ? [0x40, 0xC0, 0x3F, 0xBF, 0x41, 0xC1]
    : [raw[7]];
  const mantissaFillSets = [0x80, 0x00, 0xC0];
  let best = null;
  let bestScore = Infinity;
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  for (const fill of mantissaFillSets) {
    for (let i = 0; i < 6; i++) view.setUint8(i, raw[i] === UNKNOWN ? fill : raw[i]);
    for (const b6 of b6Values) {
      view.setUint8(6, b6);
      for (const b7 of b7Values) {
        view.setUint8(7, b7);
        const value = view.getFloat64(0, true);
        if (!Number.isFinite(value) || Math.abs(value) >= 500) continue;
        const abs = Math.abs(value);
        if (abs < 0.000001) continue;
        const magnitudeScore = Math.abs(Math.log10(abs) - 0.8);
        const rangeScore = abs > 250 ? 10 : 0;
        const score = magnitudeScore + rangeScore + (fill === 0x80 ? 0 : 0.25);
        if (score < bestScore) {
          bestScore = score;
          best = value;
        }
      }
    }
  }
  return best;
}

function rgbToHex(r, g, b) {
  const clamp = (v) => { const n = Math.round((Number.isFinite(v) ? v : 0) * 255); return Math.max(0, Math.min(255, n)); };
  return `#${[r, g, b].map(clamp).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
