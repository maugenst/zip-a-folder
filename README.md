[![NPM](https://nodei.co/npm/zip-a-folder.png)](https://nodei.co/npm/zip-a-folder/)

[![CircleCI](https://circleci.com/gh/maugenst/zip-a-folder.svg?style=shield&downloads=true&downloadRank=true&stars=true)](https://circleci.com/gh/maugenst/zip-a-folder)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/df3f742eabe741029c221fd602407d0f)](https://app.codacy.com/gh/maugenst/zip-a-folder/dashboard)
[![Codacy Coverage](https://app.codacy.com/project/badge/Coverage/df3f742eabe741029c221fd602407d0f)](https://app.codacy.com/gh/maugenst/zip-a-folder/dashboard)
[![Known Vulnerabilities](https://snyk.io/test/github/maugenst/zip-a-folder/badge.svg)](https://snyk.io/test/github/maugenst/zip-a-folder)

# zip-a-folder
A fast, dependency-free ZIP/TAR/TGZ creation library using **native Node.js compression (zlib)**, supporting:

- ZIP archives (with optional ZIP64)
- TAR archives (optionally gzipped)
- Globs (single or comma-separated)
- Parallel directory scanning (`statConcurrency`)
- Custom write streams
- Compression presets (`high`, `medium`, `uncompressed`)
- Fine-grained zlib/gzip control

Everything is implemented **natively** without JS zip/tar libraries.

---

## ⚠️ Incompatible Changes

### Version 2
Added support for comma-separated glob lists.  
This may change the behavior for cases previously interpreted as “folder only”.

### Version 3
Dual-module support (CJS + ESM).

### Version 3.1
Added support for `destPath` to control the internal path layout of created archives.

### Version 4 (current)
A major rewrite using:
- **Fully native ZIP writer** (no dependencies)
- **Native TAR + gzip writer**
- **ZIP64 support** for large archives
- **Parallel statting** (`statConcurrency`)
- **Strict internal path normalization** mirroring classic zip-a-folder behavior
- **Native glob handling** via `glob`

---

## 📦 Installation

```bash
npm install zip-a-folder
````

---

# 🚀 Usage

## Create a ZIP file

```js
import { zip } from 'zip-a-folder';

await zip('/path/to/folder', '/path/to/archive.zip');
```

## Create a GZIP-compressed TAR file (`.tgz`)

```js
import { tar } from 'zip-a-folder';

await tar('/path/to/folder', '/path/to/archive.tgz');
```

---

# 🎚 Compression Handling

Supported compression levels:

```ts
COMPRESSION_LEVEL.high          // highest compression (default)
COMPRESSION_LEVEL.medium        // balanced
COMPRESSION_LEVEL.uncompressed  // STORE for zip, no-gzip for tar
```

Example:

```js
import { zip, COMPRESSION_LEVEL } from 'zip-a-folder';

await zip('/path/to/folder', '/path/to/archive.zip', {
    compression: COMPRESSION_LEVEL.medium
});
```

---

# ✨ ZIP Options

| Option              | Type          | Description                          |
| ------------------- | ------------- | ------------------------------------ |
| `comment`           | `string`      | ZIP file comment                     |
| `forceLocalTime`    | `boolean`     | Use local timestamps instead of UTC  |
| `forceZip64`        | `boolean`     | Always include ZIP64 headers         |
| `namePrependSlash`  | `boolean`     | Prefix all ZIP entry names with `/`  |
| `store`             | `boolean`     | Force STORE method (no compression)  |
| `zlib`              | `ZlibOptions` | Passed directly to `zlib.deflateRaw` |
| `statConcurrency`   | `number`      | Parallel `stat` workers (default: 4) |
| `destPath`          | `string`      | Prefix inside the archive (>=3.1)    |
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

---

# 📦 TAR / TGZ Options

| Option            | Type          | Description                 |
| ----------------- | ------------- | --------------------------- |
| `gzip`            | `boolean`     | Enable gzip compression     |
| `gzipOptions`     | `ZlibOptions` | Passed to `zlib.createGzip` |
| `statConcurrency` | `number`      | Parallel `stat` workers     |

Example:

```js
await tar('/dir', '/archive.tgz', {
    gzip: true,
    gzipOptions: { level: 6 }
});
```

---

# 🔧 Custom Write Streams

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

* parent directory exists
* you’re not writing into the source directory (to avoid recursion)

---

# 🔍 Glob Handling

The first parameter may be:

* A path to a directory
* A single glob
* A comma-separated list of globs

Example:

```js
await zip('**/*.json', '/archive.zip');
await zip('**/*.json, **/*.txt', '/archive2.zip');
```

If no files match, zip-a-folder throws:

```
Error: No glob match found
```

---

# 🗂 Destination Path Handling (`destPath`)

Adds a prefix *inside* the archive:

```js
await zip('data/', '/archive.zip', { destPath: 'data/' });
```

Resulting ZIP layout:

```
data/file1.txt
data/subdir/file2.txt
```

## Directory Root Inclusion Semantics

When passing a directory path as the first argument (e.g. `zip('/path/to/folder', '/archive.zip')`), the archive by default contains the *contents* of that directory at the archive root (i.e. you will see the files inside `folder/`, not a top-level `folder/` directory itself).

### Include the directory itself
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

## Summary
- Default: directory contents only (no enclosing folder)  
- To include the folder: use `destPath: '<dirname>/'`

This applies equally to `tar()`.

---

# 🎯 Native Implementation Notes (New in v4)

* ZIP and TAR are written using **pure Node.js** (`zlib`, raw buffering)
* ZIP64 support included
* File system scanning performed with a **parallel stat queue**
* Globs handled via the standardized **glob** package
* Archive layout matches the original zip-a-folder for compatibility
* ZIP writer supports dependency-free deflate and manual header construction
* TAR writer produces POSIX ustar format with proper 512-byte block alignment

---

## 🛠️ Unix Permissions Preservation in ZIP (v4.x)

A recent contribution restored correct handling of file modes for Unix systems inside ZIP archives:

- The "Version Made By" field is now set to Unix (upper byte = 3) in the Central Directory.
- File modes from `fs.stat().mode` are passed through to the ZIP entries and preserved.
- Modes are mapped into the upper 16 bits of the "External File Attributes" field per the ZIP spec.

This brings parity back with v3 behavior and ensures executables and other POSIX permissions are preserved 
when packaging for Linux/Debian and similar environments.

See PR #66: https://github.com/maugenst/zip-a-folder/pull/66

Automated tests were added to validate:
- Central Directory "Version Made By" upper byte is 3 (Unix).
- External File Attributes store the POSIX mode (both files and directories), including directory flag.
- FileCollector behavior and glob handling are fully covered, pushing coverage to 100% lines/functions.

---

# 🧪 Running Tests

Tests are written in **Jest**:

```bash
npm test
```

A coverage report is included:

```bash
npm test -- --coverage
```

---

# ❤️ Thanks

Special thanks to contributors:

* @sole – initial work
* @YOONBYEONGIN
* @Wunschik
* @ratbeard
* @Xotabu4
* @dallenbaldwin
* @wiralegawa
* @karan-gaur
* @malthe
* @nesvet

Additional thanks to everyone helping shape the native rewrite.
