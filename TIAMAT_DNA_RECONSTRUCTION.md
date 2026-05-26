# Tiamat `.dna` UTF-8 Reconstruction Algorithm

## Observed corruption

The paired files

- `/Users/m.matthies/Downloads/ssRNA_6.3k_Science.dna`
- `/Users/m.matthies/Downloads/ssRNA_6.3k_Science_broken.dna`

prove that the broken file is produced exactly by:

```js
new TextEncoder().encode(new TextDecoder('utf-8').decode(originalBytes))
```

So the damage is not a DOS or Windows code page conversion. It is the standard
UTF-8 replacement decoder applied to a binary MFC `CArchive`.

Consequences:

- Valid UTF-8 byte sequences in the original binary survive byte-for-byte.
- Invalid UTF-8 subsequences become the three bytes `ef bf bd`.
- One `ef bf bd` in the broken file may mean either a real original
  `ef bf bd` byte sequence or a destroyed invalid subsequence.
- Destroyed subsequences are usually one byte, but can be two or three bytes
  when an incomplete UTF-8 prefix consumed continuation bytes.

In the ssRNA pair, the good file is 391,617 bytes and the broken file is
558,128 bytes. The broken file contains 84,819 visible `ef bf bd` triples, but
only 84,692 of them are corruption markers; 127 are genuine original bytes.

## Why zero-filling fails

At the `Nucleobase` class anchor, the good file contains:

```text
00 00 00 00 00 00 b0 18 00 00 ff ff 03 00 0a 00 4e 75 ...
                  ^ base count = 0x18b0 = 6320
```

The broken file contains:

```text
00 00 00 00 00 00 ef bf bd 18 00 00 ef bf bd ef bf bd 03 00 ...
                  ^ destroyed low byte of base count
```

Treating each replacement as byte `0x00` reads the count as `0x1800 = 6144`,
which is structurally wrong. The parser must solve unknown archive fields from
context.

## Reconstruction strategy

Use a two-level inverse:

1. Convert the broken file to a token stream.

   - Non-`U+FFFD` token: fixed original bytes equal to that token's UTF-8
     encoding.
   - `U+FFFD` token: ambiguous original slice. Candidate slices are:
     - literal `ef bf bd`
     - one invalid byte
     - an invalid/incomplete UTF-8 lead byte plus one or more continuation
       bytes when the Encoding Standard would emit a single replacement.

2. Parse the token stream with an MFC-aware constraint solver.

   Do not first flatten the stream into bytes. Instead, each read operation
   asks the solver for the next byte(s), and field readers constrain the
   possibilities.

## Constraint passes

### Pass 1: Archive structure

Recover the MFC object graph before coordinates.

- `CArchive` class declarations constrain many bytes exactly:
  - class tag `ff ff`
  - small schema integer
  - ASCII class name length and class name
- Object pointer tags constrain unknown bytes:
  - `09 80` for `Nucleobase` class references
  - small back-reference integers
  - `00 00` for null pointers
- Bool fields constrain bytes to `00` or `01`.
- Base count candidates should be enumerated when count bytes contain
  replacements. Choose the candidate that allows the archive to consume the
  expected number of `Nucleobase` objects and leaves the stream aligned.

This pass should recover the correct ssRNA count of 6320 from the broken file.

### Pass 2: Schema variants

The paired files confirm the modern source is not enough for old archives.
Schema 3 needs local variant handling:

- with color/slide/sticky fields
- no color block
- no sticky pointer
- no slide vector

Use beam search at each `Nucleobase` tail. Score candidates by:

- next pointer tag plausibility
- valid bool/int ranges
- object count progress
- final stream alignment

### Pass 3: Coordinates

Coordinates are three IEEE-754 doubles. They are the least recoverable fields
because almost every byte pattern is syntactically possible.

Use this order:

1. If all eight bytes of a double are fixed, read it normally.
2. If exponent/sign bytes are fixed and only mantissa bytes are unknown, recover
   an approximate value by filling mantissa candidates and scoring continuity.
3. If exponent/sign bytes are unknown, solve with geometric constraints:
   - neighboring `down/up` bases should be near Tiamat rise distance
   - paired `across` bases should be near pair distance
   - coordinates should remain in a plausible design bounding box
4. If coordinate confidence remains low, keep the recovered graph and rebuild a
   deterministic display layout. Mark diagnostics with `coordinateLayoutRebuilt`.

## Implementation shape

The practical parser should expose a `TokenReader` over the broken stream:

```text
Broken UTF-8 bytes -> Unicode tokens -> candidate original byte slices
                                  -> MFC constraint reader
                                  -> graph + optional coordinate solution
```

The solver should be a bounded beam, not exhaustive search. Most fields have
tiny domains, so the beam only needs to branch at:

- replacement tokens inside integer/pointer fields
- schema-tail layout decisions
- damaged coordinate bytes

Diagnostics should report:

- whether the file was UTF-8 transformed
- visible replacement triples
- solved base count
- recovered object count
- synthesized/repaired bases
- coordinate confidence
- whether coordinates were rebuilt

## Hard limit

Byte-for-byte reconstruction from a broken file alone is underdetermined. A
single replacement character can hide many different original byte sequences.
Exact reconstruction requires either the original file, another side channel, or
enough format/geometric constraints to make one candidate uniquely best.

The ssRNA pair contains a direct collision. Changing byte offset `812` in the
clean file from `0x80` to `0x81` still round-trips to the exact same broken
file:

```js
broken === new TextEncoder().encode(
  new TextDecoder('utf-8').decode(mutatedCleanBytes)
)
```

The mutated file is still a valid raw Tiamat archive and imports as 6320 bases
with coordinate quality 1. Because both raw byte streams are valid and both
produce the same broken byte stream, no algorithm can choose the original one
from the broken file alone.

## Exact recovery options

Exact recovery is possible only with extra information:

- A clean reference file: verify that `utf8RoundTrip(reference) === broken`,
  then use the reference bytes.
- A trusted sidecar format containing the missing data, such as a topology plus
  coordinate file with stable base ordering.
- Strong application constraints that uniquely determine a field. This works
  for fields like class tags, booleans, many object pointers, and sometimes
  base counts. It does not generally work for coordinate mantissa bytes.

For single-file imports, the practical result is therefore:

- recover the MFC graph as far as constraints allow;
- solve exact bytes only where the archive grammar forces them;
- mark any coordinate or synthesized-base repair in diagnostics;
- do not claim byte-perfect reconstruction unless a reference was used.
