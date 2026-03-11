//#region rolldown:runtime
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let fs = require("fs");
fs = __toESM(fs);
let path = require("path");
path = __toESM(path);
let zlib = require("zlib");
zlib = __toESM(zlib);
let tinyglobby = require("tinyglobby");
let lzma = require("lzma");
lzma = __toESM(lzma);

//#region lib/core/FileCollector.ts
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
/**
* Collect file entries from one or more glob patterns, relative to a given cwd.
*
* - Uses the "tinyglobby" package.
* - Only files are returned (no explicit directory entries).
* - Returns [] when there is no match (caller will throw "No glob match found").
*/
async function collectGlobEntries(patterns, cwd, statConcurrency = 4, exclude) {
	const patternList = patterns.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
	const matchedRelPaths = /* @__PURE__ */ new Set();
	for (const pattern of patternList) try {
		const matches = (0, tinyglobby.globSync)(pattern, {
			cwd,
			onlyFiles: true,
			dot: false,
			ignore: exclude
		});
		for (const rel of matches) matchedRelPaths.add(rel.replace(/\\/g, "/"));
	} catch {}
	const relPaths = Array.from(matchedRelPaths);
	if (relPaths.length === 0) return [];
	const entries = [];
	let index = 0;
	statConcurrency = Math.max(1, statConcurrency | 0);
	const worker = async () => {
		while (true) {
			const i = index++;
			if (i >= relPaths.length) break;
			const rel = relPaths[i];
			const abs = path.resolve(cwd, rel);
			const stat = await fs.promises.stat(abs);
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

//#endregion
//#region lib/core/utils.ts
/**
* Precomputed CRC32 table for efficient checksum calculation.
*/
const CRC32_TABLE$1 = (() => {
	const table = new Uint32Array(256);
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
		crc = CRC32_TABLE$1[(crc ^ byte) & 255] ^ crc >>> 8;
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

//#endregion
//#region lib/7z/Native7z.ts
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
/**
* CRC-32 calculation (same as used in ZIP)
*/
const CRC32_TABLE = [];
for (let i = 0; i < 256; i++) {
	let crc = i;
	for (let j = 0; j < 8; j++) crc = crc & 1 ? 3988292384 ^ crc >>> 1 : crc >>> 1;
	CRC32_TABLE[i] = crc >>> 0;
}
function crc32$1(data) {
	let crc = 4294967295;
	for (let i = 0; i < data.length; i++) crc = CRC32_TABLE[(crc ^ data[i]) & 255] ^ crc >>> 8;
	return (crc ^ 4294967295) >>> 0;
}
/**
* Simple 7z number encoding (used for headers)
*/
/* c8 ignore start - large number encoding only triggered with files >127 bytes compressed */
function encode7zNumber(value) {
	if (value < 128) return Buffer.from([value]);
	const buf = Buffer.alloc(9);
	buf[0] = 255;
	buf.writeBigUInt64LE(BigInt(value), 1);
	return buf;
}
/* c8 ignore stop */
/**
* Write Windows FILETIME (100-nanosecond intervals since 1601-01-01)
*/
function dateToFiletime(date) {
	const EPOCH_DIFF = BigInt(0xa9730b66800);
	return (BigInt(date.getTime()) + EPOCH_DIFF) * BigInt(1e4);
}
/**
* Native 7z archive writer using pure JavaScript LZMA compression.
*/
var Native7z = class {
	/**
	* @param compressionLevel LZMA compression level 1-9 (default: 5)
	*/
	constructor(compressionLevel = 5) {
		this.files = [];
		this.compressionLevel = Math.max(1, Math.min(9, compressionLevel));
	}
	/**
	* Add a file to the archive from filesystem.
	*/
	async addFile(entry) {
		if (entry.isDirectory) return;
		const data = await fs.promises.readFile(entry.fsPath);
		const compressedData = await this.compressLzma(data);
		this.files.push({
			entry,
			data,
			compressedData
		});
	}
	/**
	* Compress data using LZMA.
	*/
	compressLzma(data) {
		return new Promise((resolve, reject) => {
			lzma.default.compress(data, this.compressionLevel, (result, error) => {
				/* c8 ignore start - LZMA error handling is hard to trigger in tests */
				if (error || result instanceof Error) {
					reject(error || result);
					return;
				}
				/* c8 ignore stop */
				const unsigned = result.map((b) => b < 0 ? b + 256 : b);
				resolve(Buffer.from(unsigned));
			});
		});
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
		const packedData = Buffer.concat(this.files.map((f) => f.compressedData));
		const header = this.buildHeader();
		const compressedHeader = await this.compressLzma(header);
		const nextHeaderOffset = BigInt(packedData.length);
		const nextHeaderSize = BigInt(compressedHeader.length);
		const nextHeaderCRC = crc32$1(compressedHeader);
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
			packedData,
			compressedHeader
		]);
	}
	/**
	* Build the 7z header with file metadata.
	*/
	buildHeader() {
		const parts = [];
		parts.push(Buffer.from([kHeader]));
		parts.push(this.buildMainStreamsInfo());
		parts.push(this.buildFilesInfo());
		parts.push(Buffer.from([kEnd]));
		return Buffer.concat(parts);
	}
	/**
	* Build MainStreamsInfo section.
	*/
	buildMainStreamsInfo() {
		const parts = [];
		parts.push(Buffer.from([kMainStreamsInfo]));
		parts.push(this.buildPackInfo());
		parts.push(this.buildUnpackInfo());
		parts.push(this.buildSubStreamsInfo());
		parts.push(Buffer.from([kEnd]));
		return Buffer.concat(parts);
	}
	/**
	* Build PackInfo section (packed/compressed sizes).
	*/
	buildPackInfo() {
		const parts = [];
		parts.push(Buffer.from([kPackInfo]));
		parts.push(encode7zNumber(0));
		parts.push(encode7zNumber(this.files.length));
		parts.push(Buffer.from([kSize]));
		for (const file of this.files) parts.push(encode7zNumber(file.compressedData.length));
		parts.push(Buffer.from([kEnd]));
		return Buffer.concat(parts);
	}
	/**
	* Build UnpackInfo section (codec and uncompressed sizes).
	*/
	buildUnpackInfo() {
		const parts = [];
		parts.push(Buffer.from([kUnpackInfo]));
		parts.push(Buffer.from([kFolder]));
		parts.push(encode7zNumber(this.files.length));
		parts.push(Buffer.from([0]));
		for (const _file of this.files) {
			parts.push(Buffer.from([1]));
			const coderFlags = LZMA_CODEC_ID.length;
			parts.push(Buffer.from([coderFlags]));
			parts.push(LZMA_CODEC_ID);
		}
		parts.push(Buffer.from([kCodersUnpackSize]));
		for (const file of this.files) parts.push(encode7zNumber(file.data.length));
		parts.push(Buffer.from([kEnd]));
		return Buffer.concat(parts);
	}
	/**
	* Build SubStreamsInfo section.
	*/
	buildSubStreamsInfo() {
		const parts = [];
		parts.push(Buffer.from([kSubStreamsInfo]));
		parts.push(Buffer.from([kNumUnpackStream]));
		for (let i = 0; i < this.files.length; i++) parts.push(encode7zNumber(1));
		parts.push(Buffer.from([kEnd]));
		return Buffer.concat(parts);
	}
	/**
	* Build FilesInfo section (file names, attributes, times).
	*/
	buildFilesInfo() {
		const parts = [];
		parts.push(Buffer.from([kFilesInfo]));
		parts.push(encode7zNumber(this.files.length));
		parts.push(this.buildFileNames());
		parts.push(this.buildMTimes());
		parts.push(this.buildAttributes());
		parts.push(Buffer.from([kEnd]));
		return Buffer.concat(parts);
	}
	/**
	* Build file names section (UTF-16LE encoded).
	*/
	buildFileNames() {
		const parts = [];
		parts.push(Buffer.from([kNames]));
		const namesData = [];
		for (const file of this.files) {
			const name = file.entry.relativePath.replace(/\//g, "\\");
			const nameBuffer = Buffer.from(name, "utf16le");
			namesData.push(nameBuffer);
			namesData.push(Buffer.from([0, 0]));
		}
		const allNames = Buffer.concat(namesData);
		parts.push(encode7zNumber(allNames.length + 1));
		parts.push(Buffer.from([0]));
		parts.push(allNames);
		return Buffer.concat(parts);
	}
	/**
	* Build modification times section.
	*/
	buildMTimes() {
		const parts = [];
		parts.push(Buffer.from([kMTime]));
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
		const parts = [];
		parts.push(Buffer.from([kAttributes]));
		const dataSize = 2 + 4 * this.files.length;
		parts.push(encode7zNumber(dataSize));
		parts.push(Buffer.from([1]));
		parts.push(Buffer.from([0]));
		for (const file of this.files) {
			const buf = Buffer.alloc(4);
			const attr = file.entry.isDirectory ? 16 : 32;
			buf.writeUInt32LE(attr);
			parts.push(buf);
		}
		return Buffer.concat(parts);
	}
};

//#endregion
//#region lib/tar/NativeTar.ts
/**
* Create a 512-byte TAR header block for a file or directory.
*/
function createTarHeader(name, size, mtimeSeconds, mode, isDirectory) {
	const buf = Buffer.alloc(512, 0);
	writeString(buf, name, 0, 100);
	writeOctal(buf, mode & 4095, 100, 8);
	writeOctal(buf, 0, 108, 8);
	writeOctal(buf, 0, 116, 8);
	writeOctal(buf, size, 124, 12);
	writeOctal(buf, Math.floor(mtimeSeconds), 136, 12);
	for (let i = 148; i < 156; i++) buf[i] = 32;
	buf[156] = (isDirectory ? "5" : "0").charCodeAt(0);
	writeString(buf, "ustar", 257, 6);
	writeString(buf, "00", 263, 2);
	let sum = 0;
	for (let i = 0; i < 512; i++) sum += buf[i];
	writeOctal(buf, sum, 148, 8);
	return buf;
}
/**
* Minimal TAR writer used to build tar streams for .tar / .tgz files.
*/
var NativeTar = class {
	constructor(stream) {
		this.stream = stream;
	}
	/**
	* Add a directory entry (no data, only header).
	*/
	async addDirectory(entry) {
		let name = entry.relativePath.replace(/\\/g, "/");
		if (!name.endsWith("/")) name += "/";
		const header = createTarHeader(name, 0, entry.stat.mtime.getTime() / 1e3, entry.stat.mode, true);
		await writeToStream(this.stream, header);
	}
	/**
	* Add a file entry (header + file data + padding to 512 bytes).
	*/
	async addFile(entry) {
		const name = entry.relativePath.replace(/\\/g, "/");
		const data = await fs.promises.readFile(entry.fsPath);
		const header = createTarHeader(name, data.length, entry.stat.mtime.getTime() / 1e3, entry.stat.mode, false);
		await writeToStream(this.stream, header);
		await writeToStream(this.stream, data);
		const remainder = data.length % 512;
		if (remainder !== 0) {
			const padding = Buffer.alloc(512 - remainder, 0);
			await writeToStream(this.stream, padding);
		}
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

//#endregion
//#region lib/zip/NativeZip.ts
/**
* Low-level ZIP entry representation.
*/
var ZipEntry = class {
	constructor(params) {
		this.localHeaderOffset = 0;
		this.name = params.name;
		this.isDirectory = params.isDirectory;
		this.date = params.date;
		this.mode = params.mode;
		this.crc32 = params.crc32;
		this.compressedSize = params.compressedSize;
		this.uncompressedSize = params.uncompressedSize;
		this.compressionMethod = params.compressionMethod;
		this.compressedData = params.compressedData;
	}
};
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
		this.useLocalTime = options.forceLocalTime === true;
		this.forceZip64 = options.forceZip64 === true;
		this.store = options.store === true;
		this.zlibOptions = options.zlib;
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
		const data = await fs.promises.readFile(filePath);
		const sum = crc32(data);
		let compressed;
		let method;
		if (this.store) {
			compressed = data;
			method = 0;
		} else {
			compressed = zlib.deflateRawSync(data, this.zlibOptions);
			method = 8;
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
				let useZip64 = this.forceZip64;
				for (const entry of this.entries) {
					const nameBuffer = Buffer.from(entry.name, "utf8");
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
					const localHeader = Buffer.alloc(30);
					let p = 0;
					localHeader.writeUInt32LE(67324752, p);
					p += 4;
					localHeader.writeUInt16LE(useZip64 ? 45 : 20, p);
					p += 2;
					localHeader.writeUInt16LE(0, p);
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
					centralHeader.writeUInt16LE(0, p);
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
						const extra = Buffer.alloc(4 + extraSize);
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

//#endregion
//#region lib/ZipAFolder.ts
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
var ZipAFolder = class {
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
			case "high":
				if (zlibOptions.level === void 0) zlibOptions.level = zlib.constants.Z_BEST_COMPRESSION;
				break;
			default: break;
		}
		const zipper = new NativeZip({
			comment: options.comment,
			forceLocalTime: options.forceLocalTime,
			forceZip64: options.forceZip64,
			namePrependSlash: options.namePrependSlash,
			store: zipStore,
			zlib: zlibOptions
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
		for (const e of entries.filter((x) => !x.isDirectory)) await zipper.addFileFromFs(e.fsPath, e.relativePath, e.stat.mtime, e.stat.mode);
		if (!customWS && hasTargetPath) {
			const parentDir = path.dirname(path.resolve(targetFilePath));
			await fs.promises.stat(parentDir);
		}
		const outStream = customWS ?? fs.createWriteStream(targetFilePath);
		await zipper.writeToStream(outStream);
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
			case "high":
				if (gzipOptions.level === void 0) gzipOptions.level = zlib.constants.Z_BEST_COMPRESSION;
				break;
			default: break;
		}
		const brotliOptions = { ...options.brotliOptions || {} };
		if (compressionType === "brotli" && options.compression !== void 0) {
			if (!brotliOptions.params) brotliOptions.params = {};
			if (brotliOptions.params[zlib.constants.BROTLI_PARAM_QUALITY] === void 0) switch (options.compression) {
				case "medium":
					brotliOptions.params[zlib.constants.BROTLI_PARAM_QUALITY] = 6;
					break;
				case "high":
					brotliOptions.params[zlib.constants.BROTLI_PARAM_QUALITY] = zlib.constants.BROTLI_MAX_QUALITY;
					break;
				default: break;
			}
		}
		if (!customWS && hasTargetPath) {
			const parentDir = path.dirname(path.resolve(targetFilePath));
			await fs.promises.stat(parentDir);
		}
		const finalOut = customWS ?? fs.createWriteStream(targetFilePath);
		let tarDestination;
		if (compressionType === "gzip") {
			const gzipStream = zlib.createGzip(gzipOptions);
			gzipStream.pipe(finalOut);
			tarDestination = gzipStream;
		} else if (compressionType === "brotli") {
			const brotliStream = zlib.createBrotliCompress(brotliOptions);
			brotliStream.pipe(finalOut);
			tarDestination = brotliStream;
		} else tarDestination = finalOut;
		const tarWriter = new NativeTar(tarDestination);
		for (const e of entries.filter((x) => x.isDirectory)) await tarWriter.addDirectory(e);
		for (const e of entries.filter((x) => !x.isDirectory)) await tarWriter.addFile(e);
		await tarWriter.finalize();
		await new Promise((resolve, reject) => {
			const finishTarget = compressionType !== "none" ? finalOut : tarDestination;
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
		let compressionLevel = options.compressionLevel ?? 5;
		if (options.compression !== void 0) switch (options.compression) {
			case "uncompressed":
				compressionLevel = 1;
				break;
			case "medium":
				compressionLevel = 5;
				break;
			case "high":
				compressionLevel = 9;
				break;
		}
		if (!customWS && hasTargetPath) {
			const parentDir = path.dirname(path.resolve(targetFilePath));
			await fs.promises.stat(parentDir);
		}
		const outStream = customWS ?? fs.createWriteStream(targetFilePath);
		const sevenZWriter = new Native7z(compressionLevel);
		for (const e of entries) await sevenZWriter.addFile(e);
		await sevenZWriter.writeToStream(outStream);
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

//#endregion
exports.COMPRESSION_LEVEL = COMPRESSION_LEVEL;
exports.ZipAFolder = ZipAFolder;
exports.sevenZip = sevenZip;
exports.tar = tar;
exports.zip = zip;