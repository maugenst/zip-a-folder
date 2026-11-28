[![NPM](https://nodei.co/npm/zip-a-folder.png)](https://nodei.co/npm/zip-a-folder/)

[![CircleCI](https://circleci.com/gh/maugenst/zip-a-folder.svg?style=shield&downloads=true&downloadRank=true&stars=true)](https://circleci.com/gh/maugenst/zip-a-folder)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/df3f742eabe741029c221fd602407d0f)](https://app.codacy.com/gh/maugenst/zip-a-folder/dashboard)
[![Codacy Coverage](https://app.codacy.com/project/badge/Coverage/df3f742eabe741029c221fd602407d0f)](https://app.codacy.com/gh/maugenst/zip-a-folder/dashboard)
[![Known Vulnerabilities](https://snyk.io/test/github/maugenst/zip-a-folder/badge.svg)](https://snyk.io/test/github/maugenst/zip-a-folder)

# zip-a-folder

Compress a folder into ZIP/TAR/TGZ/BR/7z. This library tries to use as few dependencies as possible.
For ZIP, TAR and Brotli archives it uses the **native Node.js compression (zlib)**.
7z uses **`@napi-rs/lzma`** — a native binary addon with pre-built binaries for 17 platforms (Linux, macOS, Windows, ARM, musl, FreeBSD) and a WASM fallback for everything else. No compiler or build tools required.

Feature overview:

- ZIP archives (with optional ZIP64)
- TAR archives (optionally gzipped or brotli-compressed)
- **7z archives** with native LZMA compression (via `@napi-rs/lzma`)
- Fine-grained zlib/gzip/brotli/LZMA control
- Globs (single or comma-separated)
- Parallel directory scanning (`statConcurrency`)
- Custom write streams
- Compression presets (`high`, `medium`, `uncompressed`)

> **Philosophy — ease of use first.** zip-a-folder is built to make archiving a
> folder simple, dependency-light, and predictable — nothing more, nothing less.
> It is **not** built to be the fastest or to squeeze out the highest compression
> ratio. For most of that it is close (see [7z Performance vs 7-Zip](#7z-performance-vs-7-zip)),
> but if raw speed and maximum compression are your priority, reach for a native
> implementation such as [`7z-bin`](https://www.npmjs.com/package/7z-bin) instead.

---

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
  - [Create a ZIP file](#create-a-zip-file)
  - [Create a GZIP-compressed TAR file](#create-a-gzip-compressed-tar-file-tgz)
- [Compression Handling](#compression-handling)
- [ZIP Options](#zip-options)
- [TAR / TGZ Options](#tar--tgz-options)
- [7z Options](#7z-options)
- [Custom Write Streams](#custom-write-streams)
- [Glob Handling](#glob-handling)
- [Destination Path Handling (destPath)](#destination-path-handling-destpath)
- [Excluding Files and Directories (exclude)](#excluding-files-and-directories-exclude)
- [Module Import Structure](#module-import-structure)
- [Native Implementation Notes](#native-implementation-notes)
- [7z Performance vs 7-Zip](#7z-performance-vs-7-zip)
- [Unix Permissions Preservation in ZIP](#unix-permissions-preservation-in-zip)
- [Command Line Interface (CLI)](#command-line-interface-cli)
- [Running Tests](#running-tests)
- [Thanks](#thanks)
- [Changelog](#changelog)

---

## Installation

> **Requires Node.js `^22.20 || ^24.12 || >=25`** (imposed by the native `@napi-rs/lzma` dependency).

```bash
npm install zip-a-folder
```

---

## Usage

### Create a ZIP file

```js
import { zip } from 'zip-a-folder';

await zip('/path/to/folder', '/path/to/archive.zip');
```

### Create a GZIP-compressed TAR file (`.tgz`)

```js
import { tar } from 'zip-a-folder';

await tar('/path/to/folder', '/path/to/archive.tgz');
```

### Return value

`zip()`, `tar()` and `sevenZip()` resolve with an `ArchiveResult`:

```ts
type ArchiveResult = {
    count: number; // number of regular files written (directories excluded)
    size: number;  // size of the written archive, in bytes
};
```

```js
import { zip } from 'zip-a-folder';

const { count, size } = await zip('/path/to/folder', '/path/to/archive.zip');
console.log(`archived ${count} files into ${size} bytes`);
```

`size` is measured from the bytes actually written, so it is reported even when
you pass a `customWriteStream` and there is no target path to `stat`. Callers
that ignore the returned value keep working unchanged.

### Progress reporting

All three functions accept an `onProgress` callback that receives an integer
percent (0–100) as files are archived:

```js
await zip('/path/to/folder', '/path/to/archive.zip', {
    onProgress: (percent) => process.stdout.write(`\rpacking… ${percent}%`)
});
```

The value is **monotonic** (never decreases), starts above 0, and **100 is always
emitted once** at the end. Progress is based on input bytes processed:

- For **ZIP** and **TAR/TGZ/TAR.BR** it tracks the actual per-file compression as
  each file is written.
- For **7z** it reflects the file-reading phase only. All data is then compressed
  in a single native LZMA step that cannot be subdivided, so progress approaches
  the high-90s as the last file is read and the final `100` fires once that step
  completes.

---

## Compression Handling

Supported compression levels:

```ts
COMPRESSION_LEVEL.high          // highest compression (default)
COMPRESSION_LEVEL.medium        // balanced
COMPRESSION_LEVEL.uncompressed  // STORE for zip, no-gzip for tar
```

> **v5:** `COMPRESSION_LEVEL` is now a `const` object with **string** values (`'high'`, `'medium'`, `'uncompressed'`).
> The `compression` option accepts either the constant (`COMPRESSION_LEVEL.high`) or the plain string (`'high'`) directly.

Example:

```js
import { zip, COMPRESSION_LEVEL } from 'zip-a-folder';

await zip('/path/to/folder', '/path/to/archive.zip', {
    compression: COMPRESSION_LEVEL.medium  // or just 'medium'
});
```

---

## ZIP Options

| Option              | Type          | Description                          |
| ------------------- | ------------- | ------------------------------------ |
| `comment`           | `string`      | ZIP file comment                     |
| `forceLocalTime`    | `boolean`     | Local timestamps (default `true`); `false` stores UTC |
| `forceZip64`        | `boolean`     | Always include ZIP64 headers         |
| `namePrependSlash`  | `boolean`     | Prefix all ZIP entry names with `/`  |
| `store`             | `boolean`     | Force STORE method (no compression)  |
| `zlib`              | `ZlibOptions` | Passed directly to `zlib.deflateRaw` |
| `password`          | `string`      | Encrypt file contents (default AES-256). Filenames stay readable. |
| `encryptionMethod`  | `'aes256' \| 'zipcrypto'` | Encryption scheme when `password` is set (default `'aes256'`; `'zipcrypto'` is weak, for legacy readers) |
| `statConcurrency`   | `number`      | Parallel `stat` workers (default: 4) |
| `destPath`          | `string`      | Prefix inside the archive (>=3.1)    |
| `exclude`           | `string[]`    | Glob patterns for paths to omit      |
| `onProgress`        | `(percent: number) => void` | Archiving progress callback (0–100) |
| `customWriteStream` | `WriteStream` | Manually handle output               |

Example:

```js
await zip('/dir', '/archive.zip', {
    comment: "Created by zip-a-folder",
    forceZip64: true,
    namePrependSlash: true,
    store: false,
    statConcurrency: 16,
    zlib: { level: 9 }
});
```

### Password protection

```js
// Strong, recommended: WinZip AES-256 (the default)
await zip('/dir', '/archive.zip', { password: 'correct horse battery staple' });
```

By default, file contents are encrypted with **WinZip AES-256** (the AE-2 scheme:
PBKDF2-HMAC-SHA1 key derivation, AES-256 in counter mode, HMAC-SHA1
authentication). Filenames and metadata stay readable; the *contents* require the
password. 7-Zip, WinZip, p7zip and macOS `bsdtar` open it with the password, and
the wrong password is rejected. The encryption uses Node's built-in `crypto` — no
extra dependency.

The scheme is selectable via `encryptionMethod` (only used when `password` is set):

```js
// Legacy compatibility: PKWARE "ZipCrypto"
await zip('/dir', '/archive.zip', {
    password: 'correct horse battery staple',
    encryptionMethod: 'zipcrypto'
});
```

- `'aes256'` (default) — strong AES-256. Use this unless you have a specific
  reason not to.
- `'zipcrypto'` — legacy PKWARE encryption. **Cryptographically broken** (a
  practical known-plaintext attack recovers the keystream), so do not rely on it
  for real confidentiality. Its *only* advantage is reach: it opens in old
  readers that predate AES — including the `unzip`/`ditto` bundled with macOS and
  Finder's Archive Utility, and Windows Explorer's built-in zip. Passwords are
  encoded as UTF-8 (matching 7-Zip); stick to ASCII passwords for maximum
  cross-tool compatibility.

> **Decrypting an AES zip on macOS:** the native `bsdtar` (libarchive) supports
> AES zips, while the bundled `unzip`/`ditto` and Finder do not (they report
> "unsupported compression method" for method 99):
>
> ```bash
> bsdtar -xf archive.zip --passphrase 'correct horse battery staple'
> ```
>
> If you specifically need the archive to open by double-clicking in Finder or
> with the bundled `unzip`, use `encryptionMethod: 'zipcrypto'` — accepting its
> weak security.

---

## TAR / TGZ / TAR.BR Options

| Option              | Type                       | Description                                                      |
| ------------------- | -------------------------- | ---------------------------------------------------------------- |
| `compressionType`   | `'none' \| 'gzip' \| 'brotli'` | Compression algorithm (default: `'gzip'`)                    |
| `gzip`              | `boolean`                  | Enable gzip compression (deprecated, use `compressionType`)      |
| `gzipOptions`       | `ZlibOptions`              | Passed to `zlib.createGzip`                                      |
| `brotliOptions`     | `BrotliOptions`            | Passed to `zlib.createBrotliCompress`                            |
| `statConcurrency`   | `number`                   | Parallel `stat` workers                                          |
| `exclude`           | `string[]`                 | Glob patterns to omit                                            |
| `onProgress`        | `(percent: number) => void` | Archiving progress callback (0–100)                            |
| `compression`       | `COMPRESSION_LEVEL`        | Convenience preset (`high`, `medium`, `uncompressed`)            |

> **No password option for TAR.** The tar format and the gzip/brotli stream
> formats define no in-archive encryption, so there is nothing interoperable to
> implement — a `.tgz`/`.tar.br` is always readable by standard tools. For an
> encrypted archive, use `zip()` or `sevenZip()` with a `password`, or encrypt
> the output yourself (e.g. pipe through `gpg`).

### Gzip Example

```js
await tar('/dir', '/archive.tgz', {
    compressionType: 'gzip',
    gzipOptions: { level: 6 }
});
```

### Brotli Example

Brotli compression is supported natively via Node.js `zlib` module (available since Node.js v10.16.0).
Brotli typically provides better compression ratios than gzip, especially for text-based content.

```js
import { tar, COMPRESSION_LEVEL } from 'zip-a-folder';
import * as zlib from 'zlib';

// Simple brotli compression
await tar('/dir', '/archive.tar.br', {
    compressionType: 'brotli'
});

// With compression level preset
await tar('/dir', '/archive.tar.br', {
    compressionType: 'brotli',
    compression: COMPRESSION_LEVEL.high
});

// With custom brotli options
await tar('/dir', '/archive.tar.br', {
    compressionType: 'brotli',
    brotliOptions: {
        params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,  // 0-11, higher = better compression
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
        }
    }
});
```

### Uncompressed TAR

```js
await tar('/dir', '/archive.tar', {
    compressionType: 'none'
});
```

---

## 7z Options

Create 7z archives with LZMA compression using the `sevenZip()` function.

| Option              | Type               | Description                                           |
| ------------------- | ------------------ | ----------------------------------------------------- |
| `compression`       | `COMPRESSION_LEVEL`| Convenience preset (`high` → 9, `medium` → 5, `uncompressed` → 1). Ignored when `compressionLevel` is set. |
| `compressionLevel`  | `number` (1-9)     | LZMA compression level (default: 5). Takes precedence over `compression`. |
| `password`          | `string`           | Encrypt the data with AES-256 (`7zAES`). Filenames stay readable. |
| `statConcurrency`   | `number`           | Parallel `stat` workers (default: 4)                  |
| `exclude`           | `string[]`         | Glob patterns to omit                                 |
| `onProgress`        | `(percent: number) => void` | Archiving progress callback (0–100; see [Progress reporting](#progress-reporting)) |
| `customWriteStream` | `WriteStream`      | Manually handle output                                |

### Basic Example

```js
import { sevenZip } from 'zip-a-folder';

await sevenZip('/path/to/folder', '/path/to/archive.7z');
```

### With Compression Level

```js
import { sevenZip, COMPRESSION_LEVEL } from 'zip-a-folder';

// Using preset
await sevenZip('/dir', '/archive.7z', {
    compression: COMPRESSION_LEVEL.high
});

// Using explicit level (1-9)
await sevenZip('/dir', '/archive.7z', {
    compressionLevel: 9
});
```

### With Glob Patterns

```js
await sevenZip('src/**/*.ts', '/archive.7z');
```

### With Exclusions

```js
await sevenZip('/project', '/archive.7z', {
    exclude: ['node_modules/**', '**/*.log']
});
```

### With a Password (AES-256)

```js
await sevenZip('/project', '/archive.7z', {
    password: 'correct horse battery staple'
});
```

The archive data is encrypted with AES-256 (the 7z `7zAES` coder) using a
key derived from the password with 7-Zip's SHA-256 key-derivation function.
Filenames and other metadata stay readable (the same as `7z a -p<password>`
without `-mhe`); the file *contents* require the password. 7-Zip and p7zip
open it with `7z x -p<password>`, and the wrong password is rejected. The
encryption uses Node's built-in `crypto` — no extra dependency.

> **Note:** 7z archives use native LZMA compression via `@napi-rs/lzma`. Pre-built binaries are automatically
> selected at install time for your platform — no compiler required. A WASM fallback is used on unsupported
> platforms. The 7z format stores files as a solid archive, meaning all file data is concatenated and compressed
> together for better compression efficiency. Each entry carries its own CRC-32, and archives open and extract in
> 7-Zip, p7zip and other standard 7z readers.

---

## Custom Write Streams

ZIP and TAR can be written into **any stream**.
If `customWriteStream` is used, the `targetFilePath` can be empty or undefined.

```js
import fs from 'fs';
import { zip } from 'zip-a-folder';

const ws = fs.createWriteStream('/tmp/output.zip');
await zip('/path/to/folder', undefined, { customWriteStream: ws });
```

**Important:**
zip-a-folder does *not* validate custom streams. You must ensure:

- parent directory exists
- you're not writing into the source directory (to avoid recursion)

---

## Glob Handling

The first parameter may be:

- A path to a directory
- A single glob
- A comma-separated list of globs

Glob patterns are resolved relative to `process.cwd()`. Patterns that escape the working directory — those containing `..` segments or absolute paths — throw an error:

```js
await zip('**/*.json', '/archive.zip');           // OK: in-cwd glob
await zip('**/*.json, **/*.txt', '/archive2.zip'); // OK: comma-separated
await zip('../secrets/*', '/archive.zip');          // throws: escapes cwd
await zip('/etc/pass*', '/archive.zip');            // throws: absolute path
```

If no files match, zip-a-folder throws:

```
Error: No glob match found
```

> **Symlinks are not followed.** Both directory and glob sources are enumerated with `followSymbolicLinks: false` and symlinked entries are additionally skipped. A symlink inside the source tree that points outside it (to a file or a directory) is never archived, so a directory whose contents are controlled by someone else cannot be used to smuggle host files (keys, `.env`, …) into the archive.

---

## Destination Path Handling (`destPath`)

Adds a prefix *inside* the archive:

```js
await zip('data/', '/archive.zip', { destPath: 'data/' });
```

Resulting ZIP layout:

```
data/file1.txt
data/subdir/file2.txt
```

### Directory Root Inclusion Semantics

When passing a directory path as the first argument (e.g. `zip('/path/to/folder', '/archive.zip')`), the archive by default contains the *contents* of that directory at the archive root (i.e. you will see the files inside `folder/`, not a top-level `folder/` directory itself).

#### Include the directory itself

If you want the archive to unpack into the named folder (so the top level of the archive contains `folder/`), set `destPath` to that folder name plus a trailing slash:

```ts
await zip('/path/to/folder', '/archive.zip', {
  destPath: 'folder/'
});
```

Result layout:

```
folder/file1.txt
folder/sub/file2.txt
```

### Summary

- Default: directory contents only (no enclosing folder)
- To include the folder: use `destPath: '<dirname>/'`

This applies equally to `tar()`.

---

## Excluding Files and Directories (`exclude`)

The `exclude` option accepts an array of **picomatch-style glob patterns**.
Matching entries (files and directories) are omitted from the archive entirely —
when a directory is excluded its entire subtree is skipped.

```js
import { zip } from 'zip-a-folder';

const packed = await zip('/path/to/project', '/path/to/archive.zip', {
  exclude: [
    // dot-files (.env, .DS_Store, …)
    '**/.*',
    // dot-directories (.git, .vscode, …) and their contents
    '**/.*/**',
    // build output and dependencies
    'dist/**',
    'dist/',
    'node_modules/**',
    'node_modules/',
  ]
});
```

> **Notes:**
>
> - `exclude` is applied to **directory sources** and **glob sources** alike.
> - For glob sources, the patterns are passed as additional `ignore` entries to tinyglobby.
> - Patterns are matched against **relative paths** inside the source directory (POSIX-style).
> - To exclude a whole directory tree, add both `dirname/` and `dirname/**` (or just `dirname/**`).

Inspired by [issue #65](https://github.com/maugenst/zip-a-folder/issues/65) reported by [@Pomax](https://github.com/Pomax).

---

## Module Import Structure

> **Note:** As of v4 and the modernized build, all code is bundled into a single entry file. Do not import submodules (e.g. `dist/lib/mjs/core/types`). Always import from the main entry point:

```js
import { zip, tar, COMPRESSION_LEVEL } from 'zip-a-folder';
```

If you need types, import from the main entry point as well:

```js
import type { ZipArchiveOptions, TarArchiveOptions } from 'zip-a-folder';
```

---

## Native Implementation Notes

- ZIP and TAR are written using **pure Node.js** (`zlib`, raw buffering)
- 7z uses **`@napi-rs/lzma`** — native pre-built binaries for 17 platforms, WASM fallback otherwise
- ZIP64 support included
- File system scanning performed with a **parallel stat queue**
- Globs handled via the **tinyglobby** package
- Archive layout matches the original zip-a-folder for compatibility
- ZIP writer supports dependency-free deflate and manual header construction
- TAR writer produces POSIX ustar format with proper 512-byte block alignment

---

## 7z Performance vs 7-Zip

zip-a-folder's `sevenZip()` uses the native `@napi-rs/lzma` binding. It is **not**
trying to beat the full `7z` binary — it aims to produce correct, standard 7z
archives with zero runtime dependencies and no separate executable to ship. For
a sense of the trade-off, there is a local benchmark that compares it against
the `7z-bin` binary (a devDependency, used only for testing/benchmarking):

```bash
npm run build && npm run benchmark
```

Representative run (Apple M-series, 8.5 MiB corpus of compressible text + random
binary, median of 5 runs — your numbers will vary):

| level | zip-a-folder | 7z-bin | compressed size Δ |
| ----- | ------------ | ------ | ----------------- |
| 1     | ~330 ms      | ~50 ms  | −0.3% (slightly smaller) |
| 5     | ~760 ms      | ~350 ms | +1.3% |
| 9     | ~1130 ms     | ~700 ms | +1.4% |

### Reasoning for the differences

- **Speed — `7z-bin` is ~2–7× faster.** The `7z` binary is native, heavily
  hand-optimized C++ and **multi-threaded**; it splits work across cores. `@napi-rs/lzma`
  runs the compression on a single thread, so wall-clock time is higher — most
  visibly at level 1, where fixed LZMA setup cost dominates a small workload.
- **Compression — within ~1–2%, essentially on par.** The raw LZMA stream
  `@napi-rs/lzma` produces is close to optimal, so for most inputs the sizes are
  nearly identical (and zip-a-folder can even come out marginally smaller at the
  lowest level). `7z` pulls slightly ahead at higher levels because it applies
  extra **filters** — BCJ/branch filters for executables, delta filters — and
  finer LZMA2 parameter tuning that `@napi-rs/lzma` does not expose. The gap is
  largest on binary-heavy, filterable data and negligible on plain text.
- **Why not just shell out to `7z`?** That would reintroduce an external binary
  dependency (platform-specific, must be installed or bundled), which is exactly
  what the native implementation avoids. If you need the absolute best ratio or
  speed and can take that dependency, a tool like `7z-bin` is the right choice;
  if you want a self-contained, dependency-light 7z writer, this is the trade.

---

## Unix Permissions Preservation in ZIP

A recent contribution restored correct handling of file modes for Unix systems inside ZIP archives:

- The "Version Made By" field is now set to Unix (upper byte = 3) in the Central Directory.
- File modes from `fs.stat().mode` are passed through to the ZIP entries and preserved.
- Modes are mapped into the upper 16 bits of the "External File Attributes" field per the ZIP spec.

This brings parity back with v3 behavior and ensures executables and other POSIX permissions are preserved
when packaging for Linux/Debian and similar environments.

See PR #66: <https://github.com/maugenst/zip-a-folder/pull/66>

Automated tests were added to validate:

- Central Directory "Version Made By" upper byte is 3 (Unix).
- External File Attributes store the POSIX mode (both files and directories), including directory flag.
- FileCollector behavior and glob handling are fully covered, pushing coverage to 100% lines/functions.

---

## Command Line Interface (CLI)

zip-a-folder includes a CLI for quick archive creation from the terminal.

### Installation

```bash
# Global installation
npm install -g zip-a-folder

# Or use via npx
npx zip-a-folder ./folder ./archive.zip
```

### Usage

```bash
zip-a-folder <source> <target> [options]
```

### Supported Formats

| Extension   | Description                        |
| ----------- | ---------------------------------- |
| `.zip`      | ZIP archive (deflate compression)  |
| `.tar`      | TAR archive (uncompressed)         |
| `.tgz`      | TAR archive with gzip compression  |
| `.tar.gz`   | TAR archive with gzip compression  |
| `.tar.br`   | TAR archive with brotli compression|
| `.7z`       | 7z archive with LZMA compression   |

### Options

| Option                    | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `-h, --help`              | Show help message                                |
| `-V, --version`           | Show version number                              |
| `-v, --verbose`           | Show detailed progress (files being processed)   |
| `-q, --quiet`             | Suppress all output except errors                |
| `-c, --compression <level>`| Compression preset: `high`, `medium`, `uncompressed` |
| `-l, --level <number>`    | Compression level (1-9, format-specific)         |
| `-e, --exclude <pattern>` | Glob pattern to exclude (can be used multiple times) |
| `-d, --dest-path <path>`  | Destination path prefix inside archive           |

### Examples

```bash
# Create a ZIP archive
zip-a-folder ./my-folder ./archive.zip

# Create a gzipped TAR with verbose output
zip-a-folder ./src ./backup.tgz -v

# Create a 7z archive with maximum compression
zip-a-folder ./project ./project.7z -c high

# Create archive excluding node_modules
zip-a-folder ./app ./app.zip -e "node_modules/**" -e "**/*.log"

# Create brotli-compressed TAR
zip-a-folder ./data ./data.tar.br -v

# Use glob patterns
zip-a-folder "src/**/*.ts" ./source.zip

# Quiet mode (only errors)
zip-a-folder ./folder ./archive.zip -q
```

### Output

By default, the CLI shows a summary with:
- Source and target paths
- Archive format
- File count
- Original and compressed sizes
- Compression ratio
- Processing time

Use `-v` for detailed file-by-file progress, or `-q` to suppress all output.

---

## Running Tests

Tests are written in **Vitest** with full coverage (100% statements/branches/functions/lines):

```bash
npm test
```

Coverage is reported automatically via `@vitest/coverage-v8`.

A separate **Bun** test suite covers the full test matrix under Bun's runtime and also acts as a regression guard for [issue #73](https://github.com/maugenst/zip-a-folder/issues/73) (process hang after `sevenZip()`):

```bash
bun test ./test/tests-7z.bun.test.ts
```

A local benchmark compares the native `sevenZip()` against the `7z-bin` binary (build first so it runs against `dist/`):

```bash
npm run build && npm run benchmark
```

---

## Thanks

Special thanks to contributors:

- @sole – initial work
- @YOONBYEONGIN
- @Wunschik
- @ratbeard
- @Xotabu4
- @dallenbaldwin
- @wiralegawa
- @karan-gaur
- @malthe
- @nesvet
- @schplitt – string-literal compression levels refactor ([PR #70](https://github.com/maugenst/zip-a-folder/pull/70))
- @Pomax – `exclude` option feature request ([issue #65](https://github.com/maugenst/zip-a-folder/issues/65))
- @DragonPwn (Abdullah Hassan) – responsible disclosure of the glob cwd-escape vulnerability fixed in v7.0.1
- @DocBouCou – UTF-8 ZIP filename flag ([issue #75](https://github.com/maugenst/zip-a-folder/issues/75)) and non-blocking async ZIP compression ([issue #76](https://github.com/maugenst/zip-a-folder/issues/76))
- [UCSB PLSE group](https://ucsbplse.github.io/) – coordinated disclosure of the symlink-escape vulnerability (reached through a symlink, bypassing the v7.0.1 cwd-escape fix), found via automated differential testing
- @jayhemnani9910 (Jay Hemnani) – default ZIP timestamps to local time ([issue #61](https://github.com/maugenst/zip-a-folder/issues/61), [PR #77](https://github.com/maugenst/zip-a-folder/pull/77)) and the long-path TAR PAX fix ([PR #82](https://github.com/maugenst/zip-a-folder/pull/82))
- @vitaly-t (Code Scratcher) – whose detailed reports and ideas drove a whole
  wave of 7z improvements: the corrupt-7z fix ([issue #81](https://github.com/maugenst/zip-a-folder/issues/81)),
  the `{ count, size }` archive result ([issue #80](https://github.com/maugenst/zip-a-folder/issues/80)),
  and the compression-level precedence fix plus 7z/ZIP AES-256 password support
  ([issue #83](https://github.com/maugenst/zip-a-folder/issues/83)). The concrete
  suggestions in those issues — including the `7z-bin` comparison — shaped how
  these features were designed and implemented.

Additional thanks to everyone helping shape the native rewrite.

---

## Changelog

### Version 2

Added support for comma-separated glob lists.
This may change the behavior for cases previously interpreted as "folder only".

### Version 3

Dual-module support (CJS + ESM).

### Version 3.1

Added support for `destPath` to control the internal path layout of created archives.

### Version 4

A major rewrite using:

- **Fully native ZIP writer** (no dependencies)
- **Native TAR + gzip writer**
- **ZIP64 support** for large archives
- **Parallel statting** (`statConcurrency`)
- **Strict internal path normalization** mirroring classic zip-a-folder behavior
- **Native glob handling** via `tinyglobby`

### Version 5

- `COMPRESSION_LEVEL` is now a plain `const` object whose values are **string literals** (`'uncompressed'`, `'medium'`, `'high'`) instead of a numeric enum.
  The public API (`COMPRESSION_LEVEL.high`, etc.) is unchanged — only the underlying type changed from a TypeScript `enum` to a `const satisfies` object. See [PR #70](https://github.com/maugenst/zip-a-folder/pull/70) by [@schplitt](https://github.com/schplitt).
- Added `exclude` option — an array of glob patterns for files/directories to omit from the archive. See [issue #65](https://github.com/maugenst/zip-a-folder/issues/65) by [@Pomax](https://github.com/Pomax).

### Version 6

- **Native Brotli compression support** for TAR archives using Node.js built-in `zlib.brotliCompressSync()`. Create `.tar.br` files with the new `compressionType: 'brotli'` option. Brotli typically provides better compression ratios than gzip, especially for text-based content.
- **New 7z archive format support** via the `sevenZip()` function. Uses pure JavaScript LZMA compression (via `lzma-js` library) — no external binaries required. Provides excellent compression ratios with the industry-standard 7z format.
- New `brotliOptions` for fine-grained control over brotli compression parameters.
- New `compressionLevel` option (1-9) for 7z archives to control LZMA compression level.

### Version 7

- **Native LZMA via `@napi-rs/lzma`** replaces the pure-JavaScript `lzma-js` for 7z compression.
  Pre-built binaries are downloaded automatically at `npm install` for 17 platforms (Linux x64/arm64 GNU+musl, macOS x64/arm64, Windows x64/arm64/x32, FreeBSD, Android, RISC-V) with a WASM fallback for everything else. No compiler or `node-gyp` required.
  This is a **significant performance improvement** — compression is 5–10× faster than the old pure-JS implementation.
- **Node.js ≥ 22.20 required** (imposed by `@napi-rs/lzma`). Specifically: `^22.20 || ^24.12 || >=25`.
  Node 20 and Node 23 are no longer supported.
- The **7z options API is unchanged** — no migration needed.
- Fixes [issue #73](https://github.com/maugenst/zip-a-folder/issues/73): the process no longer hangs after `sevenZip()` completes (caused by open handles in the old pure-JS worker thread).

### Version 7.0.1 (security patch)

- **Security fix (glob mode — all formats):** Glob patterns that escape the working directory (patterns containing `..` segments, or absolute paths) now throw a descriptive error instead of silently packaging files from outside cwd. Reported by Abdullah Hassan ([@DragonPwn](https://github.com/DragonPwn)) via coordinated disclosure.
- **ZIP entry-name hardening:** Archive entry names containing `..` path segments (e.g. produced by a `destPath: '../../poc'` option) now throw an error at the point the entry is added, preventing Zip-Slip on extraction by tools that don't sanitize entry names.
- **ZIP length validation:** Passing a comment or entry name whose UTF-8 byte length exceeds 65535 (the ZIP format's 16-bit limit) now throws a descriptive error instead of an uncaught `RangeError` that crashed the calling process.

### Version 7.1

- **UTF-8 ZIP filenames:** ZIP entries whose names contain non-ASCII characters (e.g. `Zoë.txt`, `café/`) now set the language-encoding flag (general-purpose bit 11, `0x0800`) in both the local file header and the central directory. Readers such as Python's `zipfile` now decode accented names correctly instead of mojibake like `Zo├½.txt`. Pure-ASCII names are unaffected. Fixes [issue #75](https://github.com/maugenst/zip-a-folder/issues/75) reported by [@DocBouCou](https://github.com/DocBouCou).
- **Non-blocking ZIP compression:** `NativeZip` now compresses file data with the asynchronous `zlib.deflateRaw` (running on Node's threadpool) instead of the synchronous `deflateRawSync`, so zipping no longer blocks the event loop. The public Promise-based API is unchanged. Fixes [issue #76](https://github.com/maugenst/zip-a-folder/issues/76) reported by [@DocBouCou](https://github.com/DocBouCou).
- **Security fix (symlink escape — all formats):** A symlink inside the source tree could smuggle files from outside it into an archive, bypassing the v7.0.1 cwd-escape guard. In directory mode a symlinked directory was walked (archiving its target's files under the link name, e.g. `linkdir/key.txt`); in glob mode a symlinked file (`linkfile.txt`) or files reached through a symlinked directory were followed via `fs.stat`. Both collectors now pass `followSymbolicLinks: false` to the glob and additionally reject symlinks with `lstat`, so only files genuinely inside the source tree are archived. This also covers `tar()` and `sevenZip()`, which use the same collectors. Found with automated differential testing by the [UCSB PLSE group](https://ucsbplse.github.io/) and reported via coordinated disclosure.
- **ZIP timestamps now default to local time:** ZIP stores file times in DOS date/time fields, which carry no timezone and are read as **local time** by virtually every tool (`unzip`, Python `zipfile`, 7-Zip, Windows). Previously `NativeZip` wrote UTC unless `forceLocalTime: true` was passed, so outside UTC extracted mtimes were off by the UTC offset. Local time is now the default; pass `forceLocalTime: false` to keep the old UTC behaviour. Fixes [issue #61](https://github.com/maugenst/zip-a-folder/issues/61) via [PR #77](https://github.com/maugenst/zip-a-folder/pull/77) by [@jayhemnani9910](https://github.com/jayhemnani9910).

### Version 7.3.0 (current)

- **7z archives are no longer corrupt.** The native 7z writer produced files that every 7-Zip reader rejected with `Headers Error`. Three faults combined: the packed data was an XZ-container stream placed behind an LZMA1 coder, the coder carried no LZMA property bytes, and the 7z variable-length integer encoder was wrong for any value ≥ 128 (so any archive larger than ~127 bytes broke). The writer now emits a single **solid raw-LZMA stream** with the correct 5-byte coder properties and a corrected number encoder, stores paths with forward slashes, and records a per-file CRC. Archives now open and extract in 7-Zip / p7zip, and the solid layout compresses noticeably better than before. Compression still runs purely through the native `@napi-rs/lzma` dependency — no external binaries. Fixes [issue #81](https://github.com/maugenst/zip-a-folder/issues/81) reported by [@vitaly-t](https://github.com/vitaly-t).
- **`zip()`, `tar()` and `sevenZip()` now resolve with `{ count, size }`** — the number of regular files written to the archive and the archive's size in bytes — instead of `void`. The size is measured from the bytes actually written, so it is correct even when writing to a `customWriteStream` (where there is no target path to `stat`). Existing callers that ignore the return value are unaffected. Fixes [issue #80](https://github.com/maugenst/zip-a-folder/issues/80) requested by [@vitaly-t](https://github.com/vitaly-t).
- **CLI summary reflects the real archive.** The `zip-a-folder` CLI now takes the compressed size and the written-file count straight from the archive result, so the completion summary reports exactly what was archived (honouring `--exclude` and glob matching) instead of re-walking the source.
- **TAR keeps paths longer than 100 bytes.** The ustar `name` field holds only 100 bytes, so `tar()` silently truncated longer paths — and two files sharing their first 100 bytes (common under `node_modules`, e.g. `…/TextInputField.module.js` and `…/TextInputField.module.css`) collapsed to the same name, losing one on extraction. `NativeTar` now emits a PAX extended header carrying the full path before any over-length file or directory entry, which GNU tar, bsdtar, busybox, Python's `tarfile`, node-tar and 7-Zip all read. Via [PR #82](https://github.com/maugenst/zip-a-folder/pull/82) by [@jayhemnani9910](https://github.com/jayhemnani9910).
- **7z `compressionLevel` now takes precedence over the `compression` preset.** When both options were set, the `compression` preset (`'high'`/`'medium'`/`'uncompressed'`) silently overrode an explicit numeric `compressionLevel` (1-9), so bumping the level appeared to do nothing. The numeric level is the more specific control and now wins; the `compression` preset only applies when no `compressionLevel` is given (`'high'` → 9, `'medium'` → 5, `'uncompressed'` → 1, default 5). Raised in [issue #83](https://github.com/maugenst/zip-a-folder/issues/83) by [@vitaly-t](https://github.com/vitaly-t).
- **7z AES-256 password encryption.** `sevenZip()` accepts a new `password` option that encrypts the archive data with the 7z `7zAES` coder (AES-256-CBC, key derived via 7-Zip's SHA-256 KDF), decryptable by 7-Zip / p7zip with the same password and rejected with a wrong one. Filenames and metadata stay readable, matching `7z a -p<password>` without `-mhe`. Implemented with Node's built-in `crypto` — no new dependency. Requested in [issue #83](https://github.com/maugenst/zip-a-folder/issues/83) by [@vitaly-t](https://github.com/vitaly-t).
- **ZIP AES-256 password encryption.** `zip()` accepts the same `password` option, encrypting file contents with WinZip AES-256 (the AE-2 scheme: PBKDF2-HMAC-SHA1, AES-256-CTR, HMAC-SHA1 auth), readable by 7-Zip / WinZip and other AES-aware ZIP tools. Filenames stay readable; wrong passwords are rejected. Also uses Node's built-in `crypto`. `tar()` has no `password` option because the tar/gzip/brotli formats define no in-archive encryption. Part of [issue #83](https://github.com/maugenst/zip-a-folder/issues/83) by [@vitaly-t](https://github.com/vitaly-t).
- **Optional legacy ZipCrypto for `zip()`.** A new `encryptionMethod: 'aes256' | 'zipcrypto'` option (default `'aes256'`) lets you opt into PKWARE ZipCrypto when you need to open the archive with a legacy reader such as the `unzip`/`ditto` bundled with macOS, Finder's Archive Utility, or Windows Explorer. ZipCrypto is **cryptographically broken** and documented as such — it exists for compatibility only, never as the default. Validated against 7-Zip, `bsdtar` and macOS `unzip`.
- **Archiving progress callback.** `zip()`, `tar()` and `sevenZip()` accept an `onProgress: (percent: number) => void` option that reports monotonic 0–100 progress based on input bytes, always ending at 100. For ZIP/TAR it tracks per-file compression; for 7z it reflects the file-reading phase before the single native LZMA step. Inspired by the `onProgress` design in [@vitaly-t](https://github.com/vitaly-t)'s `sftp-zip-deploy`, raised in [issue #83](https://github.com/maugenst/zip-a-folder/issues/83).
- **Local 7z benchmark.** `npm run benchmark` compares `sevenZip()` against the `7z-bin` binary for speed and compression ratio, so the native-vs-binary trade-off is measurable rather than asserted. See [7z Performance vs 7-Zip](#7z-performance-vs-7-zip).
