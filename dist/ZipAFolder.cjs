Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
// \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
let fs = require("fs");
fs = __toESM(fs, 1);
let path = require("path");
path = __toESM(path, 1);
let zlib = require("zlib");
zlib = __toESM(zlib, 1);
let crypto = require("crypto");
crypto = __toESM(crypto, 1);
let _napi_rs_lzma = require("@napi-rs/lzma");
let tinyglobby = require("tinyglobby");
let stream = require("stream");
let util = require("util");
// lib/7z/Native7z.ts
/**
* 7z archive format constants
*/
const SIGNATURE = Buffer.from([
	55,
	122,
	188,
	175,
	39,
	28
]);
const VERSION_MAJOR = 0;
const VERSION_MINOR = 4;
const kEnd = 0;
const kHeader = 1;
const kMainStreamsInfo = 4;
const kFilesInfo = 5;
const kPackInfo = 6;
const kUnpackInfo = 7;
const kSubStreamsInfo = 8;
const kSize = 9;
const kCRC = 10;
const kFolder = 11;
const kCodersUnpackSize = 12;
const kNumUnpackStream = 13;
const kNames = 17;
const kMTime = 20;
const kAttributes = 21;
const LZMA_CODEC_ID = Buffer.from([
	3,
	1,
	1
]);
const AES_CODEC_ID = Buffer.from([
	6,
	241,
	7,
	1
]);
const CODER_FLAG_ATTRIBUTES = 32;
const AES_BLOCK_SIZE = 16;
const AES_NUM_CYCLES_POWER = 19;
const LZMA_HEADER_LENGTH = 13;
const FILE_ATTRIBUTE_DIRECTORY = 16;
const FILE_ATTRIBUTE_ARCHIVE = 32;
/**
* CRC-32 calculation (same as used in ZIP)
*/
const CRC32_TABLE$1 = [];
for (let i = 0; i < 256; i++) {
	let crc = i;
	for (let j = 0; j < 8; j++) crc = crc & 1 ? 3988292384 ^ crc >>> 1 : crc >>> 1;
	CRC32_TABLE$1[i] = crc >>> 0;
}
function crc32$1(data) {
	let crc = 4294967295;
	for (let i = 0; i < data.length; i++) crc = CRC32_TABLE$1[(crc ^ data[i]) & 255] ^ crc >>> 8;
	return (crc ^ 4294967295) >>> 0;
}
/**
* 7z variable-length number encoding.
*
* The first byte's high bits form a unary mask: a run of `k` set high bits
* means `k` little-endian extra bytes follow (the value's low bytes). When
* fewer than 8 extra bytes are used, the first byte's remaining low bits hold
* the value's high bits. Supports the full 64-bit range via BigInt arithmetic.
*/
function encode7zNumber(value) {
	const v = BigInt(value);
	let k = 0;
	while (k < 8 && v >= 1n << BigInt(7 * (k + 1))) k++;
	const extra = [];
	let tmp = v;
	for (let i = 0; i < k; i++) {
		extra.push(Number(tmp & 255n));
		tmp >>= 8n;
	}
	let firstByte = 0;
	for (let i = 0; i < k; i++) firstByte |= 128 >> i;
	firstByte |= Number(v >> BigInt(8 * k));
	return Buffer.from([firstByte, ...extra]);
}
/**
* Write Windows FILETIME (100-nanosecond intervals since 1601-01-01)
*/
function dateToFiletime(date) {
	const EPOCH_DIFF = BigInt(0xa9730b66800);
	return (BigInt(date.getTime()) + EPOCH_DIFF) * BigInt(1e4);
}
/**
* 7z's AES key-derivation function (as implemented by 7-Zip's `CKeyInfo`):
* a single running SHA-256 fed `salt ++ passwordUTF16LE ++ counter` for
* 2^numCyclesPower rounds, with an 8-byte little-endian counter incremented
* each round. The 32-byte digest is the AES-256 key.
*/
function deriveAesKey(password, salt, numCyclesPower) {
	const passwordBytes = Buffer.from(password, "utf16le");
	const rounds = 1n << BigInt(numCyclesPower);
	const hash = crypto.createHash("sha256");
	const counter = Buffer.alloc(8, 0);
	for (let i = 0n; i < rounds; i++) {
		hash.update(salt);
		hash.update(passwordBytes);
		hash.update(counter);
		for (let b = 0; b < 8; b++) {
			counter[b] = counter[b] + 1 & 255;
			if (counter[b] !== 0) break;
		}
	}
	return hash.digest();
}
/**
* Native 7z archive writer using @napi-rs/lzma for fast native LZMA compression.
*
* All file contents are compressed into a single solid LZMA stream held in one
* 7z folder. The 7z LZMA coder expects a *raw* LZMA1 stream plus a 5-byte
* property blob; `LzmaCompressor` emits a `.lzma` container whose 13-byte header
* carries exactly those property bytes, so the header is split off and recorded
* as the coder properties while the remaining raw stream becomes the pack data.
*/
var Native7z = class {
	/**
	* @param compressionLevel LZMA compression level 1-9 (default: 5)
	* @param password         Optional password; when set, the data is encrypted
	*                         with AES-256 (the `7zAES` coder).
	*/
	constructor(compressionLevel = 5, password) {
		this.files = [];
		this.compressionLevel = Math.max(1, Math.min(9, compressionLevel));
		this.password = password && password.length > 0 ? password : void 0;
	}
	/**
	* Add a file to the archive from filesystem.
	*/
	async addFile(entry) {
		if (entry.isDirectory) return;
		const data = await fs.promises.readFile(entry.fsPath);
		this.files.push({
			entry,
			data,
			crc: crc32$1(data)
		});
	}
	/**
	* Number of regular files added to the archive.
	*/
	get fileCount() {
		return this.files.length;
	}
	/**
	* Compress the concatenated file data into a single solid raw LZMA stream.
	* Returns the 5-byte LZMA property blob and the raw stream (header stripped).
	*/
	async compressSolid(data) {
		const compressor = new _napi_rs_lzma.LzmaCompressor({ preset: this.compressionLevel });
		const head = compressor.update(data);
		const tail = await compressor.finish();
		const lzma = Buffer.concat([head, tail]);
		return {
			props: Buffer.from(lzma.subarray(0, 5)),
			stream: Buffer.from(lzma.subarray(LZMA_HEADER_LENGTH))
		};
	}
	/**
	* Finalize and write the archive to a stream.
	*/
	async writeToStream(outStream) {
		if (this.files.length === 0) throw new Error("Cannot create empty 7z archive");
		const archiveData = await this.buildArchive();
		return new Promise((resolve, reject) => {
			outStream.on("error", reject);
			outStream.on("finish", resolve);
			outStream.write(archiveData, (err) => {
				/* c8 ignore start */
				if (err) reject(err);
				else outStream.end?.();
				/* c8 ignore stop */
			});
		});
	}
	/**
	* Build the complete 7z archive.
	*/
	async buildArchive() {
		const uncompressed = Buffer.concat(this.files.map((f) => f.data));
		const { props, stream } = await this.compressSolid(uncompressed);
		const { packed, aes } = this.maybeEncrypt(stream);
		const header = this.buildHeader(props, packed.length, stream.length, uncompressed.length, aes);
		const nextHeaderOffset = BigInt(packed.length);
		const nextHeaderSize = BigInt(header.length);
		const nextHeaderCRC = crc32$1(header);
		const startHeader = Buffer.alloc(20);
		startHeader.writeBigUInt64LE(nextHeaderOffset, 0);
		startHeader.writeBigUInt64LE(nextHeaderSize, 8);
		startHeader.writeUInt32LE(nextHeaderCRC, 16);
		const startHeaderCRC = crc32$1(startHeader);
		const signatureHeader = Buffer.alloc(32);
		SIGNATURE.copy(signatureHeader, 0);
		signatureHeader[6] = VERSION_MAJOR;
		signatureHeader[7] = VERSION_MINOR;
		signatureHeader.writeUInt32LE(startHeaderCRC, 8);
		startHeader.copy(signatureHeader, 12);
		return Buffer.concat([
			signatureHeader,
			packed,
			header
		]);
	}
	/**
	* When a password is set, encrypt the LZMA stream with AES-256-CBC after
	* zero-padding it to a 16-byte boundary, and return the ciphertext plus the
	* coder's property blob. Otherwise return the stream unchanged.
	*/
	maybeEncrypt(stream) {
		if (!this.password) return { packed: stream };
		const iv = crypto.randomBytes(AES_BLOCK_SIZE);
		const key = deriveAesKey(this.password, Buffer.alloc(0), AES_NUM_CYCLES_POWER);
		const padLength = (AES_BLOCK_SIZE - stream.length % AES_BLOCK_SIZE) % AES_BLOCK_SIZE;
		const padded = Buffer.concat([stream, Buffer.alloc(padLength, 0)]);
		const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
		cipher.setAutoPadding(false);
		const packed = Buffer.concat([cipher.update(padded), cipher.final()]);
		const flags = 83;
		const sizes = iv.length - 1 & 15;
		return {
			packed,
			aes: { props: Buffer.concat([Buffer.from([flags, sizes]), iv]) }
		};
	}
	/**
	* Build the 7z header with file metadata.
	*/
	buildHeader(lzmaProps, packedSize, lzmaStreamSize, unpackedSize, aes) {
		return Buffer.concat([
			Buffer.from([kHeader]),
			this.buildMainStreamsInfo(lzmaProps, packedSize, lzmaStreamSize, unpackedSize, aes),
			this.buildFilesInfo(),
			Buffer.from([kEnd])
		]);
	}
	/**
	* Build MainStreamsInfo section for the single solid folder.
	*/
	buildMainStreamsInfo(lzmaProps, packedSize, lzmaStreamSize, unpackedSize, aes) {
		return Buffer.concat([
			Buffer.from([kMainStreamsInfo]),
			this.buildPackInfo(packedSize),
			this.buildUnpackInfo(lzmaProps, lzmaStreamSize, unpackedSize, aes),
			this.buildSubStreamsInfo(),
			Buffer.from([kEnd])
		]);
	}
	/**
	* Build PackInfo section: one packed stream of `packedSize` bytes at offset 0.
	*/
	buildPackInfo(packedSize) {
		return Buffer.concat([
			Buffer.from([kPackInfo]),
			encode7zNumber(0),
			encode7zNumber(1),
			Buffer.from([kSize]),
			encode7zNumber(packedSize),
			Buffer.from([kEnd])
		]);
	}
	/**
	* Build a single coder record: flags byte (id size | attributes), id, and
	* the property length + bytes.
	*/
	buildCoder(id, props) {
		return Buffer.concat([
			Buffer.from([id.length | CODER_FLAG_ATTRIBUTES]),
			id,
			encode7zNumber(props.length),
			props
		]);
	}
	/**
	* Build UnpackInfo section: one folder.
	*
	* Without a password the folder has a single LZMA coder. With a password it
	* has two coders wired as `pack -> AES(decrypt) -> LZMA(decompress) -> out`,
	* matching 7-Zip's own layout: coder0 = AES, coder1 = LZMA, bound by the
	* pair (LZMA input <- AES output). The coder unpack sizes are listed per
	* out-stream in coder order: AES output = the (unpadded) LZMA stream size,
	* LZMA output = the original solid size.
	*/
	buildUnpackInfo(lzmaProps, lzmaStreamSize, unpackedSize, aes) {
		const lzmaCoder = this.buildCoder(LZMA_CODEC_ID, lzmaProps);
		let folder;
		let coderUnpackSizes;
		if (aes) {
			const aesCoder = this.buildCoder(AES_CODEC_ID, aes.props);
			folder = Buffer.concat([
				encode7zNumber(2),
				aesCoder,
				lzmaCoder,
				encode7zNumber(1),
				encode7zNumber(0)
			]);
			coderUnpackSizes = Buffer.concat([encode7zNumber(lzmaStreamSize), encode7zNumber(unpackedSize)]);
		} else {
			folder = Buffer.concat([encode7zNumber(1), lzmaCoder]);
			coderUnpackSizes = encode7zNumber(unpackedSize);
		}
		return Buffer.concat([
			Buffer.from([kUnpackInfo]),
			Buffer.from([kFolder]),
			encode7zNumber(1),
			Buffer.from([0]),
			folder,
			Buffer.from([kCodersUnpackSize]),
			coderUnpackSizes,
			Buffer.from([kEnd])
		]);
	}
	/**
	* Build SubStreamsInfo section: the single folder holds one substream per
	* file, each with its own size and CRC.
	*/
	buildSubStreamsInfo() {
		const parts = [Buffer.from([kSubStreamsInfo])];
		parts.push(Buffer.from([kNumUnpackStream]));
		parts.push(encode7zNumber(this.files.length));
		if (this.files.length > 1) {
			parts.push(Buffer.from([kSize]));
			for (let i = 0; i < this.files.length - 1; i++) parts.push(encode7zNumber(this.files[i].data.length));
		}
		parts.push(Buffer.from([kCRC]));
		parts.push(Buffer.from([1]));
		for (const file of this.files) {
			const buf = Buffer.alloc(4);
			buf.writeUInt32LE(file.crc);
			parts.push(buf);
		}
		parts.push(Buffer.from([kEnd]));
		return Buffer.concat(parts);
	}
	/**
	* Build FilesInfo section (file names, attributes, times).
	*/
	buildFilesInfo() {
		return Buffer.concat([
			Buffer.from([kFilesInfo]),
			encode7zNumber(this.files.length),
			this.buildFileNames(),
			this.buildMTimes(),
			this.buildAttributes(),
			Buffer.from([kEnd])
		]);
	}
	/**
	* Build file names section (UTF-16LE encoded).
	*/
	buildFileNames() {
		const namesData = [];
		for (const file of this.files) {
			const name = file.entry.relativePath.replace(/\\/g, "/");
			namesData.push(Buffer.from(name, "utf16le"));
			namesData.push(Buffer.from([0, 0]));
		}
		const allNames = Buffer.concat(namesData);
		return Buffer.concat([
			Buffer.from([kNames]),
			encode7zNumber(allNames.length + 1),
			Buffer.from([0]),
			allNames
		]);
	}
	/**
	* Build modification times section.
	*/
	buildMTimes() {
		const parts = [Buffer.from([kMTime])];
		const dataSize = 2 + 8 * this.files.length;
		parts.push(encode7zNumber(dataSize));
		parts.push(Buffer.from([1]));
		parts.push(Buffer.from([0]));
		for (const file of this.files) {
			const buf = Buffer.alloc(8);
			buf.writeBigUInt64LE(dateToFiletime(file.entry.stat.mtime));
			parts.push(buf);
		}
		return Buffer.concat(parts);
	}
	/**
	* Build Windows attributes section.
	*/
	buildAttributes() {
		const parts = [Buffer.from([kAttributes])];
		const dataSize = 2 + 4 * this.files.length;
		parts.push(encode7zNumber(dataSize));
		parts.push(Buffer.from([1]));
		parts.push(Buffer.from([0]));
		for (const file of this.files) {
			const buf = Buffer.alloc(4);
			/* c8 ignore next */
			const attr = file.entry.isDirectory ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_ARCHIVE;
			buf.writeUInt32LE(attr);
			parts.push(buf);
		}
		return Buffer.concat(parts);
	}
};
// lib/core/FileCollector.ts
/**
* Recursively collect entries (files + directories) under a directory,
* using a worker pool limited by statConcurrency.
*
* - The root directory itself is NOT returned as an entry.
* - Directory entries have relativePath ending with "/".
* - Entries matching any pattern in `exclude` are omitted (along with their children).
*/
async function collectEntriesFromDirectory(rootDir, statConcurrency = 4, exclude) {
	const root = path.resolve(rootDir);
	const entries = [];
	const relPaths = (0, tinyglobby.globSync)("**/*", {
		cwd: root,
		onlyFiles: false,
		dot: true,
		followSymbolicLinks: false,
		ignore: exclude
	});
	statConcurrency = Math.max(1, statConcurrency | 0);
	let index = 0;
	const worker = async () => {
		while (true) {
			const i = index++;
			if (i >= relPaths.length) break;
			const rel = relPaths[i];
			const fsPath = path.join(root, rel);
			const stat = await fs.promises.lstat(fsPath);
			/* v8 ignore next 3 */
			if (stat.isSymbolicLink()) continue;
			if (stat.isDirectory()) {
				/* v8 ignore next */
				const relDirPath = rel.endsWith("/") ? rel : rel + "/";
				entries.push({
					fsPath,
					relativePath: relDirPath.replace(/\\/g, "/"),
					isDirectory: true,
					stat
				});
			} else if (stat.isFile()) entries.push({
				fsPath,
				relativePath: rel.replace(/\\/g, "/"),
				isDirectory: false,
				stat
			});
		}
	};
	const workers = Array.from({ length: statConcurrency }, () => worker());
	await Promise.all(workers);
	return entries;
}
/** Regex matching a ".." path segment (POSIX-normalized). */
const RE_DOTDOT = /(^|\/)\.\.(\/|$)/;
/**
* Assert that an absolute resolved path is strictly inside the given root.
* Throws if the path equals the root itself or escapes it.
*
* Exported with an underscore prefix for unit testing only — not part of the
* public API and may change without notice.
*/
function _assertInsideCwd(abs, root, rel) {
	const prefix = root.endsWith(path.sep) ? root : root + path.sep;
	if (abs !== root && !abs.startsWith(prefix)) throw new Error(`Matched file escapes the working directory: "${rel}"`);
}
/**
* Collect file entries from one or more glob patterns, relative to a given cwd.
*
* - Uses the "tinyglobby" package.
* - Only files are returned (no explicit directory entries).
* - Returns [] when there is no match (caller will throw "No glob match found").
* - Throws if any pattern is absolute or contains ".." segments, or if a
*   matched file resolves outside cwd.
*/
async function collectGlobEntries(patterns, cwd, statConcurrency = 4, exclude) {
	const patternList = patterns.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
	const matchedRelPaths = /* @__PURE__ */ new Set();
	for (const pattern of patternList) {
		if (path.isAbsolute(pattern)) throw new Error(`Glob pattern escapes the working directory: "${pattern}" (absolute paths are not allowed)`);
		if (RE_DOTDOT.test(pattern.replace(/\\/g, "/"))) throw new Error(`Glob pattern escapes the working directory: "${pattern}" (.. segments are not allowed)`);
		try {
			const matches = (0, tinyglobby.globSync)(pattern, {
				cwd,
				onlyFiles: true,
				dot: false,
				followSymbolicLinks: false,
				ignore: exclude
			});
			for (const rel of matches) matchedRelPaths.add(rel.replace(/\\/g, "/"));
		} catch {}
	}
	const relPaths = Array.from(matchedRelPaths);
	if (relPaths.length === 0) return [];
	const entries = [];
	let index = 0;
	statConcurrency = Math.max(1, statConcurrency | 0);
	const root = path.resolve(cwd);
	const worker = async () => {
		while (true) {
			const i = index++;
			if (i >= relPaths.length) break;
			const rel = relPaths[i];
			const abs = path.resolve(cwd, rel);
			_assertInsideCwd(abs, root, rel);
			const stat = await fs.promises.lstat(abs);
			/* v8 ignore next 3 */
			if (stat.isSymbolicLink()) continue;
			/* v8 ignore next 3 */
			if (!stat.isFile()) continue;
			entries.push({
				fsPath: abs,
				relativePath: rel,
				isDirectory: false,
				stat
			});
		}
	};
	const workers = Array.from({ length: statConcurrency }, () => worker());
	await Promise.all(workers);
	return entries;
}
// lib/core/utils.ts
/**
* Precomputed CRC32 table for efficient checksum calculation.
*/
const CRC32_TABLE = (() => {
	const table = /* @__PURE__ */ new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++) if (c & 1) c = 3988292384 ^ c >>> 1;
		else c = c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();
/**
* Compute CRC32 checksum for a buffer.
*/
function crc32(buf) {
	let crc = 4294967295;
	for (let i = 0; i < buf.length; i++) {
		const byte = buf[i];
		crc = CRC32_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
	}
	return (crc ^ 4294967295) >>> 0;
}
/**
* Convert a Date to DOS time (HH:MM:SS/2).
* @param date      Date to convert.
* @param useLocal  When true use local time, otherwise UTC.
*/
function dateToDosTime(date, useLocal) {
	const secs = Math.floor((useLocal ? date.getSeconds() : date.getUTCSeconds()) / 2);
	const mins = useLocal ? date.getMinutes() : date.getUTCMinutes();
	return (useLocal ? date.getHours() : date.getUTCHours()) << 11 | mins << 5 | secs;
}
/**
* Convert a Date to DOS date.
* @param date      Date to convert.
* @param useLocal  When true use local time, otherwise UTC.
*/
function dateToDosDate(date, useLocal) {
	const year = useLocal ? date.getFullYear() : date.getUTCFullYear();
	const month = (useLocal ? date.getMonth() : date.getUTCMonth()) + 1;
	const day = useLocal ? date.getDate() : date.getUTCDate();
	return (year < 1980 ? 0 : year - 1980) << 9 | month << 5 | day;
}
/**
* Write an ASCII string into a buffer with a fixed maximum length.
*/
function writeString(buf, str, offset, length) {
	const bytes = Buffer.from(str, "utf8");
	bytes.copy(buf, offset, 0, Math.min(bytes.length, length));
}
/**
* Write an octal number into a buffer as ASCII text.
*/
function writeOctal(buf, value, offset, length) {
	writeString(buf, value.toString(8).padStart(length - 1, "0"), offset, length - 1);
	buf[offset + length - 1] = 0;
}
/**
* Write a 64-bit unsigned integer (up to 2^53-1) to a buffer in little-endian order.
*/
function writeUInt64LE(buf, value, offset) {
	const low = value >>> 0;
	const high = Math.floor(value / 4294967296) >>> 0;
	buf.writeUInt32LE(low, offset);
	buf.writeUInt32LE(high, offset + 4);
}
/**
* Helper to write data to a Node writable stream and await completion.
*/
function writeToStream(stream, data) {
	return new Promise((resolve, reject) => {
		/* v8 ignore next 4 */
		const onError = (err) => {
			stream.removeListener("error", onError);
			reject(err);
		};
		stream.once("error", onError);
		stream.write(data, (err) => {
			stream.removeListener("error", onError);
			/* v8 ignore next 3 */
			if (err) reject(err);
			else resolve();
		});
	});
}
/**
* Determine if a string "looks like" it contains glob characters.
*/
function looksLikeGlob(source) {
	return /[*?[\]{},]/.test(source);
}
/**
* A pass-through stream that counts the bytes flowing through it. Interposed
* between an archive writer and its final destination so the archive's output
* size can be reported even when writing to a user-supplied stream (where
* `fs.stat` on a target path is not available).
*/
var ByteCountingStream = class extends stream.PassThrough {
	constructor() {
		super();
		this.bytesCounted = 0;
		this.on("data", (chunk) => {
			this.bytesCounted += chunk.length;
		});
	}
};
/**
* Tracks archiving progress as an integer percent of a known total number of
* input bytes, invoking the callback only when the rounded percentage advances
* (monotonic, never decreasing). Call `advance` after each unit of work and
* `finish` once at the end to guarantee a final 100.
*/
var ProgressTracker = class {
	constructor(totalBytes, callback) {
		this.processed = 0;
		this.lastPercent = -1;
		this.callback = callback;
		this.total = totalBytes;
	}
	/** Record `bytes` more processed and emit the new percent if it advanced. */
	advance(bytes) {
		if (!this.callback) return;
		this.processed += bytes;
		const percent = this.total > 0 ? Math.min(99, Math.floor(this.processed / this.total * 100)) : 0;
		if (percent > 0 && percent > this.lastPercent) {
			this.lastPercent = percent;
			this.callback(percent);
		}
	}
	/** Emit the terminal 100 exactly once. */
	finish() {
		if (this.callback && this.lastPercent < 100) {
			this.lastPercent = 100;
			this.callback(100);
		}
	}
};
const ZIP_AES_SALT_LENGTH = 16;
const ZIP_AES_PBKDF2_ITERATIONS = 1e3;
const ZIP_AES_KEY_LENGTH = 32;
const ZIP_AES_AUTH_CODE_LENGTH = 10;
const AES_BLOCK_LENGTH = 16;
/**
* Encrypt a buffer with the WinZip AES-256 (AE-2) scheme used by ZIP.
*
* Returns the salt, the 2-byte password-verification value, the ciphertext, and
* the 10-byte truncated HMAC-SHA1 authentication code. The archived entry data
* is their concatenation: `salt ++ passwordVerify ++ ciphertext ++ authCode`.
*/
function winZipAesEncrypt(password, data) {
	const salt = crypto.randomBytes(ZIP_AES_SALT_LENGTH);
	const derived = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, ZIP_AES_PBKDF2_ITERATIONS, 66, "sha1");
	const encKey = derived.subarray(0, ZIP_AES_KEY_LENGTH);
	const authKey = derived.subarray(ZIP_AES_KEY_LENGTH, 64);
	const passwordVerify = Buffer.from(derived.subarray(64, 66));
	const ecb = crypto.createCipheriv("aes-256-ecb", encKey, null);
	ecb.setAutoPadding(false);
	const ciphertext = Buffer.alloc(data.length);
	const counter = Buffer.alloc(AES_BLOCK_LENGTH, 0);
	let produced = 0;
	let blockIndex = 0n;
	while (produced < data.length) {
		counter.fill(0);
		let value = blockIndex + 1n;
		for (let b = 0; b < AES_BLOCK_LENGTH && value > 0n; b++) {
			counter[b] = Number(value & 255n);
			value >>= 8n;
		}
		const keystream = ecb.update(counter);
		const n = Math.min(AES_BLOCK_LENGTH, data.length - produced);
		for (let i = 0; i < n; i++) ciphertext[produced + i] = data[produced + i] ^ keystream[i];
		produced += n;
		blockIndex++;
	}
	return {
		salt,
		passwordVerify,
		ciphertext,
		authCode: crypto.createHmac("sha1", authKey).update(ciphertext).digest().subarray(0, ZIP_AES_AUTH_CODE_LENGTH)
	};
}
var ZipCryptoKeys = class {
	constructor(password) {
		this.key0 = 305419896;
		this.key1 = 591751049;
		this.key2 = 878082192;
		for (const byte of Buffer.from(password, "utf8")) this.update(byte);
	}
	update(byte) {
		this.key0 = (CRC32_TABLE[(this.key0 ^ byte) & 255] ^ this.key0 >>> 8) >>> 0;
		this.key1 = this.key1 + (this.key0 & 255) >>> 0;
		this.key1 = Math.imul(this.key1, 134775813) + 1 >>> 0;
		this.key2 = (CRC32_TABLE[(this.key2 ^ this.key1 >>> 24) & 255] ^ this.key2 >>> 8) >>> 0;
	}
	streamByte() {
		const temp = (this.key2 | 2) >>> 0;
		return Math.imul(temp, temp ^ 1) >>> 8 & 255;
	}
	encrypt(data) {
		const out = Buffer.alloc(data.length);
		for (let i = 0; i < data.length; i++) {
			out[i] = data[i] ^ this.streamByte();
			this.update(data[i]);
		}
		return out;
	}
};
/**
* Encrypt a buffer with legacy PKWARE ZipCrypto. The output is the 12-byte
* encryption header (11 random bytes + a check byte, the high byte of the
* entry's CRC-32) followed by the encrypted data, all under one keystream.
*
* NOTE: ZipCrypto is cryptographically broken (practical known-plaintext
* attack). Use only for compatibility with legacy readers.
*/
function zipCryptoEncrypt(password, data, crc32Value) {
	const keys = new ZipCryptoKeys(password);
	const header = Buffer.concat([crypto.randomBytes(11), Buffer.from([crc32Value >>> 24 & 255])]);
	return Buffer.concat([keys.encrypt(header), keys.encrypt(data)]);
}
// lib/tar/NativeTar.ts
/**
* Create a 512-byte TAR header block for a file or directory.
*/
function createTarHeader(name, size, mtimeSeconds, mode, typeflag) {
	const buf = Buffer.alloc(512, 0);
	writeString(buf, name, 0, 100);
	writeOctal(buf, mode & 4095, 100, 8);
	writeOctal(buf, 0, 108, 8);
	writeOctal(buf, 0, 116, 8);
	writeOctal(buf, size, 124, 12);
	writeOctal(buf, Math.floor(mtimeSeconds), 136, 12);
	for (let i = 148; i < 156; i++) buf[i] = 32;
	buf[156] = typeflag.charCodeAt(0);
	writeString(buf, "ustar", 257, 6);
	writeString(buf, "00", 263, 2);
	let sum = 0;
	for (let i = 0; i < 512; i++) sum += buf[i];
	writeOctal(buf, sum, 148, 8);
	return buf;
}
/**
* A PAX record "<length> path=<name>\n", where length counts the whole record.
*/
function paxPathRecord(name) {
	const body = ` path=${name}\n`;
	const bodyLength = Buffer.byteLength(body);
	let length = bodyLength + 1;
	while (String(length).length + bodyLength !== length) length = String(length).length + bodyLength;
	return Buffer.from(`${length}${body}`, "utf8");
}
/**
* Minimal TAR writer used to build tar streams for .tar / .tgz files.
*/
var NativeTar = class {
	constructor(stream) {
		this.stream = stream;
	}
	/**
	* The ustar name field holds 100 bytes; a longer path goes in a PAX header
	* before the entry, which tar readers use instead of the cut name.
	*/
	async writeLongName(name, mtimeSeconds) {
		if (Buffer.byteLength(name) <= 100) return;
		const record = paxPathRecord(name);
		await writeToStream(this.stream, createTarHeader("PaxHeader", record.length, mtimeSeconds, 420, "x"));
		await this.writeData(record);
	}
	async writeData(data) {
		await writeToStream(this.stream, data);
		const remainder = data.length % 512;
		if (remainder !== 0) {
			const padding = Buffer.alloc(512 - remainder, 0);
			await writeToStream(this.stream, padding);
		}
	}
	/**
	* Add a directory entry (no data, only header).
	*/
	async addDirectory(entry) {
		let name = entry.relativePath.replace(/\\/g, "/");
		if (!name.endsWith("/")) name += "/";
		const mtime = entry.stat.mtime.getTime() / 1e3;
		await this.writeLongName(name, mtime);
		await writeToStream(this.stream, createTarHeader(name, 0, mtime, entry.stat.mode, "5"));
	}
	/**
	* Add a file entry (header + file data + padding to 512 bytes).
	*/
	async addFile(entry) {
		const name = entry.relativePath.replace(/\\/g, "/");
		const data = await fs.promises.readFile(entry.fsPath);
		const mtime = entry.stat.mtime.getTime() / 1e3;
		await this.writeLongName(name, mtime);
		await writeToStream(this.stream, createTarHeader(name, data.length, mtime, entry.stat.mode, "0"));
		await this.writeData(data);
	}
	/**
	* Finalize the TAR archive by writing two 512-byte zero blocks.
	*/
	async finalize() {
		const block = Buffer.alloc(512, 0);
		await writeToStream(this.stream, block);
		await writeToStream(this.stream, block);
	}
};
// lib/zip/NativeZip.ts
/**
* Asynchronous raw DEFLATE. Moves compression onto Node's threadpool so it does
* not block the event loop while files are being zipped.
*/
const deflateRawAsync = (0, util.promisify)(zlib.deflateRaw);
const ZIP_AES_METHOD = 99;
const ZIP_AES_EXTRA_ID = 39169;
const ZIP_AES_VERSION_AE2 = 2;
const ZIP_AES_STRENGTH_256 = 3;
const ZIP_GP_FLAG_ENCRYPTED = 1;
/**
* Low-level ZIP entry representation.
*/
var ZipEntry = class {
	constructor(params) {
		this.localHeaderOffset = 0;
		this.encrypted = false;
		this.actualCompressionMethod = 0;
		this.name = params.name;
		this.isDirectory = params.isDirectory;
		this.date = params.date;
		this.mode = params.mode;
		this.crc32 = params.crc32;
		this.compressedSize = params.compressedSize;
		this.uncompressedSize = params.uncompressedSize;
		this.compressionMethod = params.compressionMethod;
		this.compressedData = params.compressedData;
		this.encrypted = params.encrypted === true;
		this.actualCompressionMethod = params.actualCompressionMethod ?? params.compressionMethod;
	}
};
/** Regex matching a ".." path segment in a POSIX-normalized archive entry name. */
const RE_DOTDOT_ENTRY = /(^|\/)\.\.(\/|$)/;
/**
* Assert that an archive entry name does not contain path-traversal segments.
* Allows a single leading "/" (produced intentionally by the namePrependSlash option).
* Throws for any ".." segment.
*/
function assertSafeName(name) {
	if (RE_DOTDOT_ENTRY.test(name)) throw new Error(`Unsafe archive entry name (path traversal): "${name}"`);
}
/**
* Build the WinZip AES extra field (header id 0x9901) that records the AE-2
* version, the "AE" vendor marker, AES-256 strength, and the real compression
* method that was applied before encryption.
*/
function buildAesExtraField(actualMethod) {
	const extra = Buffer.alloc(11);
	extra.writeUInt16LE(ZIP_AES_EXTRA_ID, 0);
	extra.writeUInt16LE(7, 2);
	extra.writeUInt16LE(ZIP_AES_VERSION_AE2, 4);
	extra.write("AE", 6, "latin1");
	extra.writeUInt8(ZIP_AES_STRENGTH_256, 8);
	extra.writeUInt16LE(actualMethod, 9);
	return extra;
}
/**
* Native ZIP writer using only Node's built-in modules.
*
* - Supports standard ZIP up to 4GB.
* - Automatically enables ZIP64 structures when needed (size/offset/entry-count overflow),
*   or when forceZip64 is set.
* - Directories are stored as entries with trailing "/".
*/
var NativeZip = class {
	/* istanbul ignore next */
	constructor(options = {}) {
		this.entries = [];
		this.comment = options.comment;
		this.useLocalTime = options.forceLocalTime !== false;
		this.forceZip64 = options.forceZip64 === true;
		this.store = options.store === true;
		this.zlibOptions = options.zlib;
		this.password = options.password && options.password.length > 0 ? options.password : void 0;
		this.encryptionMethod = options.encryptionMethod ?? "aes256";
	}
	/**
	* Add a directory entry to the ZIP archive.
	* @param archivePath Path inside the archive (with or without trailing "/").
	* @param date        Modification date.
	* @param mode        File mode (permissions).
	*/
	addDirectoryEntry(archivePath, date, mode) {
		let name = archivePath.replace(/\\/g, "/");
		if (!name.endsWith("/")) name += "/";
		assertSafeName(name);
		this.entries.push(new ZipEntry({
			name,
			isDirectory: true,
			date,
			mode,
			crc32: 0,
			compressedSize: 0,
			uncompressedSize: 0,
			compressionMethod: 0,
			compressedData: Buffer.alloc(0)
		}));
	}
	/**
	* Add a file from the filesystem to the ZIP archive.
	* @param filePath    Physical file path on disk.
	* @param archivePath Path inside the archive.
	* @param date        Modification date.
	* @param mode        File mode (permissions).
	*/
	async addFileFromFs(filePath, archivePath, date, mode) {
		const name = archivePath.replace(/\\/g, "/");
		assertSafeName(name);
		const data = await fs.promises.readFile(filePath);
		const sum = crc32(data);
		let compressed;
		let method;
		if (this.store) {
			compressed = data;
			method = 0;
		} else {
			compressed = await deflateRawAsync(data, this.zlibOptions ?? {});
			method = 8;
		}
		if (this.password && this.encryptionMethod === "aes256") {
			const { salt, passwordVerify, ciphertext, authCode } = winZipAesEncrypt(this.password, compressed);
			const encrypted = Buffer.concat([
				salt,
				passwordVerify,
				ciphertext,
				authCode
			]);
			this.entries.push(new ZipEntry({
				name,
				isDirectory: false,
				date,
				mode,
				crc32: 0,
				compressedSize: encrypted.length,
				uncompressedSize: data.length,
				compressionMethod: ZIP_AES_METHOD,
				compressedData: encrypted,
				encrypted: true,
				actualCompressionMethod: method
			}));
			return;
		}
		if (this.password) {
			const encrypted = zipCryptoEncrypt(this.password, compressed, sum);
			this.entries.push(new ZipEntry({
				name,
				isDirectory: false,
				date,
				mode,
				crc32: sum,
				compressedSize: encrypted.length,
				uncompressedSize: data.length,
				compressionMethod: method,
				compressedData: encrypted,
				encrypted: true,
				actualCompressionMethod: method
			}));
			return;
		}
		this.entries.push(new ZipEntry({
			name,
			isDirectory: false,
			date,
			mode,
			crc32: sum,
			compressedSize: compressed.length,
			uncompressedSize: data.length,
			compressionMethod: method,
			compressedData: compressed
		}));
	}
	/**
	* Write the ZIP archive to a writable stream.
	* Handles ZIP64 automatically when required.
	*/
	writeToStream(stream) {
		return new Promise((resolve, reject) => {
			stream.once("error", reject);
			try {
				let offset = 0;
				const centralDirParts = [];
				const commentBuffer = this.comment ? Buffer.from(this.comment, "utf8") : Buffer.alloc(0);
				if (commentBuffer.length > 65535) throw new Error(`ZIP comment too long: ${commentBuffer.length} bytes (max 65535)`);
				let useZip64 = this.forceZip64;
				for (const entry of this.entries) {
					const nameBuffer = Buffer.from(entry.name, "utf8");
					if (nameBuffer.length > 65535) throw new Error(`ZIP entry name too long: "${entry.name.slice(0, 40)}..." is ${nameBuffer.length} bytes (max 65535)`);
					const generalFlag = (Buffer.from(entry.name, "latin1").equals(nameBuffer) ? 0 : 2048) | (entry.encrypted ? ZIP_GP_FLAG_ENCRYPTED : 0);
					const aesExtra = entry.compressionMethod === ZIP_AES_METHOD ? buildAesExtraField(entry.actualCompressionMethod) : Buffer.alloc(0);
					const dosTime = dateToDosTime(entry.date, this.useLocalTime);
					const dosDate = dateToDosDate(entry.date, this.useLocalTime);
					const needsZip64Sizes = entry.compressedSize >= 4294967295 || entry.uncompressedSize >= 4294967295 || this.forceZip64;
					const needsZip64Offset = offset >= 4294967295 || this.forceZip64;
					if (needsZip64Sizes || needsZip64Offset) useZip64 = true;
					let localExtra = Buffer.alloc(0);
					if (needsZip64Sizes) {
						const extra = Buffer.alloc(20);
						let q = 0;
						extra.writeUInt16LE(1, q);
						q += 2;
						extra.writeUInt16LE(16, q);
						q += 2;
						writeUInt64LE(extra, entry.uncompressedSize, q);
						q += 8;
						writeUInt64LE(extra, entry.compressedSize, q);
						q += 8;
						localExtra = extra;
					}
					if (aesExtra.length > 0) localExtra = Buffer.concat([localExtra, aesExtra]);
					const localHeader = Buffer.alloc(30);
					let p = 0;
					localHeader.writeUInt32LE(67324752, p);
					p += 4;
					localHeader.writeUInt16LE(useZip64 ? 45 : 20, p);
					p += 2;
					localHeader.writeUInt16LE(generalFlag, p);
					p += 2;
					localHeader.writeUInt16LE(entry.compressionMethod, p);
					p += 2;
					localHeader.writeUInt16LE(dosTime, p);
					p += 2;
					localHeader.writeUInt16LE(dosDate, p);
					p += 2;
					localHeader.writeUInt32LE(entry.crc32 >>> 0, p);
					p += 4;
					if (needsZip64Sizes) {
						localHeader.writeUInt32LE(4294967295, p);
						p += 4;
						localHeader.writeUInt32LE(4294967295, p);
						p += 4;
					} else {
						localHeader.writeUInt32LE(entry.compressedSize >>> 0, p);
						p += 4;
						localHeader.writeUInt32LE(entry.uncompressedSize >>> 0, p);
						p += 4;
					}
					localHeader.writeUInt16LE(nameBuffer.length, p);
					p += 2;
					localHeader.writeUInt16LE(localExtra.length, p);
					p += 2;
					entry.localHeaderOffset = offset;
					stream.write(localHeader);
					stream.write(nameBuffer);
					if (localExtra.length > 0) stream.write(localExtra);
					offset += localHeader.length + nameBuffer.length + localExtra.length;
					if (entry.compressedData.length > 0) {
						stream.write(entry.compressedData);
						offset += entry.compressedData.length;
					}
					const centralHeader = Buffer.alloc(46);
					p = 0;
					const centralNeedsZip64Sizes = needsZip64Sizes;
					const centralNeedsZip64Offset = needsZip64Offset;
					const centralNeedsZip64 = centralNeedsZip64Sizes || centralNeedsZip64Offset;
					centralHeader.writeUInt32LE(33639248, p);
					p += 4;
					centralHeader.writeUInt16LE(768 | (useZip64 ? 45 : 20), p);
					p += 2;
					centralHeader.writeUInt16LE(useZip64 ? 45 : 20, p);
					p += 2;
					centralHeader.writeUInt16LE(generalFlag, p);
					p += 2;
					centralHeader.writeUInt16LE(entry.compressionMethod, p);
					p += 2;
					centralHeader.writeUInt16LE(dosTime, p);
					p += 2;
					centralHeader.writeUInt16LE(dosDate, p);
					p += 2;
					centralHeader.writeUInt32LE(entry.crc32 >>> 0, p);
					p += 4;
					if (centralNeedsZip64Sizes) {
						centralHeader.writeUInt32LE(4294967295, p);
						p += 4;
						centralHeader.writeUInt32LE(4294967295, p);
						p += 4;
					} else {
						centralHeader.writeUInt32LE(entry.compressedSize >>> 0, p);
						p += 4;
						centralHeader.writeUInt32LE(entry.uncompressedSize >>> 0, p);
						p += 4;
					}
					centralHeader.writeUInt16LE(nameBuffer.length, p);
					p += 2;
					let centralExtra = Buffer.alloc(0);
					if (centralNeedsZip64) {
						const extraSize = 24;
						const extra = Buffer.alloc(28);
						let q = 0;
						extra.writeUInt16LE(1, q);
						q += 2;
						extra.writeUInt16LE(extraSize, q);
						q += 2;
						writeUInt64LE(extra, entry.uncompressedSize, q);
						q += 8;
						writeUInt64LE(extra, entry.compressedSize, q);
						q += 8;
						writeUInt64LE(extra, entry.localHeaderOffset, q);
						q += 8;
						centralExtra = extra;
					}
					if (aesExtra.length > 0) centralExtra = Buffer.concat([centralExtra, aesExtra]);
					centralHeader.writeUInt16LE(centralExtra.length, p);
					p += 2;
					centralHeader.writeUInt16LE(0, p);
					p += 2;
					centralHeader.writeUInt16LE(0, p);
					p += 2;
					centralHeader.writeUInt16LE(0, p);
					p += 2;
					const extAttr = entry.mode << 16 | (entry.isDirectory ? 16 : 0);
					centralHeader.writeUInt32LE(extAttr >>> 0, p);
					p += 4;
					if (centralNeedsZip64Offset) {
						centralHeader.writeUInt32LE(4294967295, p);
						p += 4;
					} else {
						centralHeader.writeUInt32LE(entry.localHeaderOffset >>> 0, p);
						p += 4;
					}
					centralDirParts.push(centralHeader, nameBuffer);
					if (centralExtra.length > 0) centralDirParts.push(centralExtra);
				}
				const startOfCentralDir = offset;
				const centralDirectoryBuffer = Buffer.concat(centralDirParts);
				const sizeOfCentralDir = centralDirectoryBuffer.length;
				const totalEntries = this.entries.length;
				/* v8 ignore next 3 */
				if (startOfCentralDir >= 4294967295 || sizeOfCentralDir >= 4294967295 || totalEntries >= 65535) useZip64 = true;
				stream.write(centralDirectoryBuffer);
				const offsetAfterCentralDir = startOfCentralDir + sizeOfCentralDir;
				if (useZip64) {
					const zip64Eocd = Buffer.alloc(56);
					let pz = 0;
					zip64Eocd.writeUInt32LE(101075792, pz);
					pz += 4;
					writeUInt64LE(zip64Eocd, 44, pz);
					pz += 8;
					zip64Eocd.writeUInt16LE(45, pz);
					pz += 2;
					zip64Eocd.writeUInt16LE(45, pz);
					pz += 2;
					zip64Eocd.writeUInt32LE(0, pz);
					pz += 4;
					zip64Eocd.writeUInt32LE(0, pz);
					pz += 4;
					writeUInt64LE(zip64Eocd, totalEntries, pz);
					pz += 8;
					writeUInt64LE(zip64Eocd, totalEntries, pz);
					pz += 8;
					writeUInt64LE(zip64Eocd, sizeOfCentralDir, pz);
					pz += 8;
					writeUInt64LE(zip64Eocd, startOfCentralDir, pz);
					pz += 8;
					stream.write(zip64Eocd);
					const zip64Locator = Buffer.alloc(20);
					let pl = 0;
					zip64Locator.writeUInt32LE(117853008, pl);
					pl += 4;
					zip64Locator.writeUInt32LE(0, pl);
					pl += 4;
					writeUInt64LE(zip64Locator, offsetAfterCentralDir, pl);
					pl += 8;
					zip64Locator.writeUInt32LE(1, pl);
					pl += 4;
					stream.write(zip64Locator);
				}
				const eocd = Buffer.alloc(22);
				let p3 = 0;
				eocd.writeUInt32LE(101010256, p3);
				p3 += 4;
				eocd.writeUInt16LE(0, p3);
				p3 += 2;
				eocd.writeUInt16LE(0, p3);
				p3 += 2;
				eocd.writeUInt16LE(Math.min(totalEntries, 65535), p3);
				p3 += 2;
				eocd.writeUInt16LE(Math.min(totalEntries, 65535), p3);
				p3 += 2;
				eocd.writeUInt32LE(Math.min(sizeOfCentralDir, 4294967295), p3);
				p3 += 4;
				eocd.writeUInt32LE(Math.min(startOfCentralDir, 4294967295), p3);
				p3 += 4;
				eocd.writeUInt16LE(commentBuffer.length, p3);
				p3 += 2;
				stream.write(eocd);
				if (commentBuffer.length > 0) stream.write(commentBuffer);
				stream.end?.(() => resolve());
			} catch (err) {
				reject(err);
			}
		});
	}
};
// lib/ZipAFolder.ts
const COMPRESSION_LEVEL = {
	uncompressed: "uncompressed",
	medium: "medium",
	high: "high"
};
/**
* High-level facade class that provides ZIP/TAR creation helpers.
*
* Public API expected by tests:
*  - ZipAFolder.zip(...)
*  - ZipAFolder.tar(...)
*  - zip(...)
*  - tar(...)
*/
var ZipAFolder = class ZipAFolder {
	/**
	* Create a ZIP archive from a directory or glob.
	*
	* @param source         Directory path OR glob pattern.
	* @param targetFilePath Path to target zip file. May be empty/undefined if customWriteStream is provided.
	* @param options        ZIP options.
	*/
	static async zip(source, targetFilePath, options = {}) {
		const customWS = options.customWriteStream;
		const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);
		if (!hasTargetPath && !customWS) throw new Error("You must either provide a target file path or a custom write stream to write to.");
		const statConcurrency = options.statConcurrency ?? 4;
		const zipStore = options.store === true || options.compression === "uncompressed";
		const zlibOptions = { ...options.zlib || {} };
		if (!zipStore && options.compression !== void 0) switch (options.compression) {
			case "medium":
				if (zlibOptions.level === void 0) zlibOptions.level = zlib.constants.Z_DEFAULT_COMPRESSION;
				break;
			case "high": if (zlibOptions.level === void 0) zlibOptions.level = zlib.constants.Z_BEST_COMPRESSION;
		}
		const zipper = new NativeZip({
			comment: options.comment,
			forceLocalTime: options.forceLocalTime,
			forceZip64: options.forceZip64,
			namePrependSlash: options.namePrependSlash,
			store: zipStore,
			zlib: zlibOptions,
			password: options.password,
			encryptionMethod: options.encryptionMethod
		});
		const cwd = process.cwd();
		const isGlob = looksLikeGlob(source);
		let entries = [];
		if (isGlob) {
			entries = await collectGlobEntries(source, cwd, statConcurrency, options.exclude);
			if (entries.length === 0) throw new Error("No glob match found");
		} else {
			const sourceDir = path.resolve(source);
			if (!(await fs.promises.stat(sourceDir)).isDirectory()) throw new Error("Source must be a directory when no glob pattern is used.");
			if (hasTargetPath) {
				const targetAbs = path.resolve(targetFilePath);
				const targetDir = path.dirname(targetAbs);
				const normalizedSourceDir = path.resolve(sourceDir);
				if (targetDir === normalizedSourceDir || targetDir.startsWith(normalizedSourceDir + path.sep)) throw new Error("Source and target folder must be different.");
			}
			entries = await collectEntriesFromDirectory(sourceDir, statConcurrency, options.exclude);
			if (options.destPath) {
				const prefix = options.destPath.replace(/\\/g, "/").replace(/\/+$/, "");
				if (prefix.length > 0) entries = entries.map((e) => ({
					...e,
					relativePath: prefix + "/" + e.relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
				}));
			}
		}
		if (options.namePrependSlash) entries = entries.map((e) => {
			/* v8 ignore next */
			const rp = e.relativePath.startsWith("/") ? e.relativePath : "/" + e.relativePath;
			return {
				...e,
				relativePath: rp
			};
		});
		for (const e of entries.filter((x) => x.isDirectory)) zipper.addDirectoryEntry(e.relativePath, e.stat.mtime, e.stat.mode);
		const fileEntries = entries.filter((x) => !x.isDirectory);
		const progress = new ProgressTracker(fileEntries.reduce((sum, e) => sum + e.stat.size, 0), options.onProgress);
		for (const e of fileEntries) {
			await zipper.addFileFromFs(e.fsPath, e.relativePath, e.stat.mtime, e.stat.mode);
			progress.advance(e.stat.size);
		}
		if (!customWS && hasTargetPath) {
			const parentDir = path.dirname(path.resolve(targetFilePath));
			await fs.promises.stat(parentDir);
		}
		const destination = customWS ?? fs.createWriteStream(targetFilePath);
		const counter = new ByteCountingStream();
		counter.pipe(destination);
		await zipper.writeToStream(counter);
		await ZipAFolder.awaitDrain(destination);
		progress.finish();
		return {
			count: fileEntries.length,
			size: counter.bytesCounted
		};
	}
	/**
	* Create a TAR (optionally gzipped) archive from a directory or glob.
	*
	* @param source         Directory path OR glob pattern.
	* @param targetFilePath Path to target tar/tgz file. May be empty/undefined if customWriteStream is provided.
	* @param options        TAR/gzip options.
	*/
	static async tar(source, targetFilePath, options = {}) {
		const customWS = options.customWriteStream;
		const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);
		if (!hasTargetPath && !customWS) throw new Error("You must either provide a target file path or a custom write stream to write to.");
		const statConcurrency = options.statConcurrency ?? 4;
		const cwd = process.cwd();
		const isGlob = looksLikeGlob(source);
		let entries = [];
		if (isGlob) {
			entries = await collectGlobEntries(source, cwd, statConcurrency, options.exclude);
			if (entries.length === 0) throw new Error("No glob match found");
		} else {
			const sourceDir = path.resolve(source);
			if (!(await fs.promises.stat(sourceDir)).isDirectory()) throw new Error("Source must be a directory when no glob pattern is used.");
			if (hasTargetPath) {
				const targetAbs = path.resolve(targetFilePath);
				const targetDir = path.dirname(targetAbs);
				const normalizedSourceDir = path.resolve(sourceDir);
				if (targetDir === normalizedSourceDir || targetDir.startsWith(normalizedSourceDir + path.sep)) throw new Error("Source and target folder must be different.");
			}
			entries = await collectEntriesFromDirectory(sourceDir, statConcurrency, options.exclude);
		}
		let compressionType = "gzip";
		if (options.compression === "uncompressed") compressionType = "none";
		else if (options.compressionType !== void 0) compressionType = options.compressionType;
		else if (options.gzip !== void 0) compressionType = options.gzip ? "gzip" : "none";
		const gzipOptions = { ...options.gzipOptions || {} };
		if (compressionType === "gzip" && options.compression !== void 0) switch (options.compression) {
			case "medium":
				if (gzipOptions.level === void 0) gzipOptions.level = zlib.constants.Z_DEFAULT_COMPRESSION;
				break;
			case "high": if (gzipOptions.level === void 0) gzipOptions.level = zlib.constants.Z_BEST_COMPRESSION;
		}
		const brotliOptions = { ...options.brotliOptions || {} };
		if (compressionType === "brotli" && options.compression !== void 0) {
			if (!brotliOptions.params) brotliOptions.params = {};
			if (brotliOptions.params[zlib.constants.BROTLI_PARAM_QUALITY] === void 0) switch (options.compression) {
				case "medium":
					brotliOptions.params[zlib.constants.BROTLI_PARAM_QUALITY] = 6;
					break;
				case "high": brotliOptions.params[zlib.constants.BROTLI_PARAM_QUALITY] = zlib.constants.BROTLI_MAX_QUALITY;
			}
		}
		if (!customWS && hasTargetPath) {
			const parentDir = path.dirname(path.resolve(targetFilePath));
			await fs.promises.stat(parentDir);
		}
		const finalOut = customWS ?? fs.createWriteStream(targetFilePath);
		const counter = new ByteCountingStream();
		counter.pipe(finalOut);
		let tarDestination;
		if (compressionType === "gzip") {
			const gzipStream = zlib.createGzip(gzipOptions);
			gzipStream.pipe(counter);
			tarDestination = gzipStream;
		} else if (compressionType === "brotli") {
			const brotliStream = zlib.createBrotliCompress(brotliOptions);
			brotliStream.pipe(counter);
			tarDestination = brotliStream;
		} else tarDestination = counter;
		const tarWriter = new NativeTar(tarDestination);
		for (const e of entries.filter((x) => x.isDirectory)) await tarWriter.addDirectory(e);
		const fileEntries = entries.filter((x) => !x.isDirectory);
		const progress = new ProgressTracker(fileEntries.reduce((sum, e) => sum + e.stat.size, 0), options.onProgress);
		for (const e of fileEntries) {
			await tarWriter.addFile(e);
			progress.advance(e.stat.size);
		}
		await tarWriter.finalize();
		await new Promise((resolve, reject) => {
			const finishTarget = finalOut;
			/* v8 ignore next 4 */
			const onError = (err) => {
				cleanup();
				reject(err);
			};
			const onFinish = () => {
				cleanup();
				resolve();
			};
			const cleanup = () => {
				finishTarget.removeListener("error", onError);
				finishTarget.removeListener("finish", onFinish);
			};
			finishTarget.once("error", onError);
			finishTarget.once("finish", onFinish);
			tarDestination.end?.();
		});
		progress.finish();
		return {
			count: fileEntries.length,
			size: counter.bytesCounted
		};
	}
	/**
	* Create a 7z archive from a directory or glob using LZMA compression.
	*
	* @param source         Directory path OR glob pattern.
	* @param targetFilePath Path to target .7z file. May be empty/undefined if customWriteStream is provided.
	* @param options        7z/LZMA options.
	*/
	static async sevenZip(source, targetFilePath, options = {}) {
		const customWS = options.customWriteStream;
		const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);
		if (!hasTargetPath && !customWS) throw new Error("You must either provide a target file path or a custom write stream to write to.");
		const statConcurrency = options.statConcurrency ?? 4;
		const cwd = process.cwd();
		const isGlob = looksLikeGlob(source);
		let entries = [];
		if (isGlob) {
			entries = await collectGlobEntries(source, cwd, statConcurrency, options.exclude);
			if (entries.length === 0) throw new Error("No glob match found");
		} else {
			const sourceDir = path.resolve(source);
			if (!(await fs.promises.stat(sourceDir)).isDirectory()) throw new Error("Source must be a directory when no glob pattern is used.");
			if (hasTargetPath) {
				const targetAbs = path.resolve(targetFilePath);
				const targetDir = path.dirname(targetAbs);
				const normalizedSourceDir = path.resolve(sourceDir);
				if (targetDir === normalizedSourceDir || targetDir.startsWith(normalizedSourceDir + path.sep)) throw new Error("Source and target folder must be different.");
			}
			entries = await collectEntriesFromDirectory(sourceDir, statConcurrency, options.exclude);
		}
		let compressionLevel;
		if (options.compressionLevel !== void 0) compressionLevel = options.compressionLevel;
		else switch (options.compression) {
			case "uncompressed":
				compressionLevel = 1;
				break;
			case "high":
				compressionLevel = 9;
				break;
			default: compressionLevel = 5;
		}
		if (!customWS && hasTargetPath) {
			const parentDir = path.dirname(path.resolve(targetFilePath));
			await fs.promises.stat(parentDir);
		}
		const destination = customWS ?? fs.createWriteStream(targetFilePath);
		const counter = new ByteCountingStream();
		counter.pipe(destination);
		const sevenZWriter = new Native7z(compressionLevel, options.password);
		const progress = new ProgressTracker(entries.filter((e) => !e.isDirectory).reduce((sum, e) => sum + e.stat.size, 0), options.onProgress);
		for (const e of entries) {
			await sevenZWriter.addFile(e);
			if (!e.isDirectory) progress.advance(e.stat.size);
		}
		await sevenZWriter.writeToStream(counter);
		await ZipAFolder.awaitDrain(destination);
		progress.finish();
		return {
			count: sevenZWriter.fileCount,
			size: counter.bytesCounted
		};
	}
	/**
	* Resolve once a destination stream has fully flushed (finished or closed).
	* `fs.createWriteStream` emits 'finish' after the counter's end propagates
	* through the pipe; a user-supplied stream may only emit 'close'.
	*/
	static awaitDrain(stream) {
		return new Promise((resolve, reject) => {
			/* v8 ignore next 4 -- stream already drained before we attached listeners */
			if (stream.writableFinished) {
				resolve();
				return;
			}
			const cleanup = () => {
				stream.removeListener("error", onError);
				stream.removeListener("finish", onDone);
				stream.removeListener("close", onDone);
			};
			const onDone = () => {
				cleanup();
				resolve();
			};
			/* v8 ignore next 4 */
			const onError = (err) => {
				cleanup();
				reject(err);
			};
			stream.once("finish", onDone);
			stream.once("close", onDone);
			stream.once("error", onError);
		});
	}
};
/**
* Convenience function: zip(...) directly.
*/
function zip(source, targetFilePath, options) {
	return ZipAFolder.zip(source, targetFilePath, options ?? {});
}
/**
* Convenience function: tar(...) directly.
*/
function tar(source, targetFilePath, options) {
	return ZipAFolder.tar(source, targetFilePath, options ?? {});
}
/**
* Convenience function: sevenZip(...) directly.
* Creates a 7z archive using LZMA compression.
*/
function sevenZip(source, targetFilePath, options) {
	return ZipAFolder.sevenZip(source, targetFilePath, options ?? {});
}
exports.COMPRESSION_LEVEL = COMPRESSION_LEVEL;
exports.ZipAFolder = ZipAFolder;
exports.sevenZip = sevenZip;
exports.tar = tar;
exports.zip = zip;
