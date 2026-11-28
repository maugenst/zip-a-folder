// lib/7z/Native7z.ts
import * as crypto from 'crypto';
import * as fs from 'fs';
import {LzmaCompressor} from '@napi-rs/lzma';
import type {FileEntry} from '../core/types';

/**
 * 7z archive format constants
 */
const SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]); // '7z' signature
const VERSION_MAJOR = 0;
const VERSION_MINOR = 4;

// Property IDs for 7z headers
const kEnd = 0x00;
const kHeader = 0x01;
const kMainStreamsInfo = 0x04;
const kFilesInfo = 0x05;
const kPackInfo = 0x06;
const kUnpackInfo = 0x07;
const kSubStreamsInfo = 0x08;
const kSize = 0x09;
const kCRC = 0x0a;
const kFolder = 0x0b;
const kCodersUnpackSize = 0x0c;
const kNumUnpackStream = 0x0d;
const kNames = 0x11;
const kMTime = 0x14;
const kAttributes = 0x15;

// LZMA (LZMA1) codec ID
const LZMA_CODEC_ID = Buffer.from([0x03, 0x01, 0x01]);

// 7zAES (AES-256-CBC + SHA-256 key derivation) codec ID.
const AES_CODEC_ID = Buffer.from([0x06, 0xf1, 0x07, 0x01]);

// Coder flag: the codec carries attributes (property bytes) in the header.
const CODER_FLAG_ATTRIBUTES = 0x20;

// AES block / IV size, and the SHA-256 key-derivation iteration exponent 7-Zip
// uses by default (2^19 rounds). Also the flag bit marking the IV present in
// the AES coder property byte.
const AES_BLOCK_SIZE = 16;
const AES_NUM_CYCLES_POWER = 19;
const AES_PROP_IV_PRESENT = 0x40;

// Length of the `.lzma` container header produced by LzmaCompressor:
// 1 props byte + 4 dictionary-size bytes + 8 uncompressed-size bytes.
const LZMA_HEADER_LENGTH = 13;

// Windows file attributes used in the FilesInfo section.
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_ARCHIVE = 0x20;

/**
 * CRC-32 calculation (same as used in ZIP)
 */
const CRC32_TABLE: number[] = [];
for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    CRC32_TABLE[i] = crc >>> 0;
}

function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 7z variable-length number encoding.
 *
 * The first byte's high bits form a unary mask: a run of `k` set high bits
 * means `k` little-endian extra bytes follow (the value's low bytes). When
 * fewer than 8 extra bytes are used, the first byte's remaining low bits hold
 * the value's high bits. Supports the full 64-bit range via BigInt arithmetic.
 */
function encode7zNumber(value: number): Buffer {
    const v = BigInt(value);

    // Smallest extra-byte count k such that the value fits: k high bits of the
    // first byte flag k extra bytes, leaving (7 - k) bits for the high part.
    let k = 0;
    while (k < 8 && v >= 1n << BigInt(7 * (k + 1))) {
        k++;
    }

    const extra: number[] = [];
    let tmp = v;
    for (let i = 0; i < k; i++) {
        extra.push(Number(tmp & 0xffn));
        tmp >>= 8n;
    }

    let firstByte = 0;
    for (let i = 0; i < k; i++) {
        firstByte |= 0x80 >> i;
    }
    // The leftover high bits go in the first byte. For k === 8 (values >= 2^56,
    // unreachable for real archive numbers) this shift yields 0, a no-op, so no
    // separate guard is needed.
    firstByte |= Number(v >> BigInt(8 * k));

    return Buffer.from([firstByte, ...extra]);
}

/**
 * Write Windows FILETIME (100-nanosecond intervals since 1601-01-01)
 */
function dateToFiletime(date: Date): bigint {
    // Difference between 1601 and 1970 in milliseconds
    const EPOCH_DIFF = BigInt(11644473600000);
    const ms = BigInt(date.getTime()) + EPOCH_DIFF;
    return ms * BigInt(10000); // Convert to 100-nanosecond intervals
}

/**
 * 7z's AES key-derivation function (as implemented by 7-Zip's `CKeyInfo`):
 * a single running SHA-256 fed `salt ++ passwordUTF16LE ++ counter` for
 * 2^numCyclesPower rounds, with an 8-byte little-endian counter incremented
 * each round. The 32-byte digest is the AES-256 key.
 */
function deriveAesKey(password: string, salt: Buffer, numCyclesPower: number): Buffer {
    const passwordBytes = Buffer.from(password, 'utf16le');
    const rounds = 1n << BigInt(numCyclesPower);
    const hash = crypto.createHash('sha256');
    const counter = Buffer.alloc(8, 0);

    for (let i = 0n; i < rounds; i++) {
        hash.update(salt);
        hash.update(passwordBytes);
        hash.update(counter);
        // Increment the 8-byte little-endian counter.
        for (let b = 0; b < 8; b++) {
            counter[b] = (counter[b] + 1) & 0xff;
            if (counter[b] !== 0) {
                break;
            }
        }
    }

    return hash.digest();
}

interface FileData {
    entry: FileEntry;
    data: Buffer;
    crc: number;
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
export class Native7z {
    private files: FileData[] = [];
    private compressionLevel: number;
    private password?: string;

    /**
     * @param compressionLevel LZMA compression level 1-9 (default: 5)
     * @param password         Optional password; when set, the data is encrypted
     *                         with AES-256 (the `7zAES` coder).
     */
    constructor(compressionLevel = 5, password?: string) {
        this.compressionLevel = Math.max(1, Math.min(9, compressionLevel));
        this.password = password && password.length > 0 ? password : undefined;
    }

    /**
     * Add a file to the archive from filesystem.
     */
    async addFile(entry: FileEntry): Promise<void> {
        if (entry.isDirectory) {
            // Empty directories are not stored (kept for parity with prior
            // behaviour); file entries carry the full directory structure.
            return;
        }

        const data = await fs.promises.readFile(entry.fsPath);

        this.files.push({
            entry,
            data,
            crc: crc32(data)
        });
    }

    /**
     * Number of regular files added to the archive.
     */
    get fileCount(): number {
        return this.files.length;
    }

    /**
     * Compress the concatenated file data into a single solid raw LZMA stream.
     * Returns the 5-byte LZMA property blob and the raw stream (header stripped).
     */
    private async compressSolid(data: Buffer): Promise<{props: Buffer; stream: Buffer}> {
        const compressor = new LzmaCompressor({preset: this.compressionLevel});
        const head = compressor.update(data);
        const tail = await compressor.finish();
        const lzma = Buffer.concat([head, tail]);

        // `.lzma` header = 1 props byte + 4 dict-size bytes + 8 size bytes.
        // The first five bytes are exactly the 7z LZMA coder property format.
        const props = Buffer.from(lzma.subarray(0, 5));
        const stream = Buffer.from(lzma.subarray(LZMA_HEADER_LENGTH));
        return {props, stream};
    }

    /**
     * Finalize and write the archive to a stream.
     */
    async writeToStream(outStream: NodeJS.WritableStream): Promise<void> {
        if (this.files.length === 0) {
            throw new Error('Cannot create empty 7z archive');
        }

        // Build the archive
        const archiveData = await this.buildArchive();

        return new Promise((resolve, reject) => {
            outStream.on('error', reject);
            outStream.on('finish', resolve);

            outStream.write(archiveData, (err) => {
                /* c8 ignore start */
                if (err) {
                    reject(err);
                } else {
                    (outStream as any).end?.();
                }
                /* c8 ignore stop */
            });
        });
    }

    /**
     * Build the complete 7z archive.
     */
    private async buildArchive(): Promise<Buffer> {
        // Concatenate all file contents into one solid stream, compress once.
        const uncompressed = Buffer.concat(this.files.map((f) => f.data));
        const {props, stream} = await this.compressSolid(uncompressed);

        // Optionally wrap the LZMA stream in an AES-256 layer. `packed` is what
        // lands in the archive; `lzmaSize` is the LZMA coder's output (the
        // original solid length) and `streamSize` the LZMA coder's *input* (the
        // raw LZMA stream length, unpadded) which the AES coder decodes to.
        const {packed, aes} = this.maybeEncrypt(stream);

        const header = this.buildHeader(props, packed.length, stream.length, uncompressed.length, aes);

        // Build start header
        const nextHeaderOffset = BigInt(packed.length);
        const nextHeaderSize = BigInt(header.length);
        const nextHeaderCRC = crc32(header);

        const startHeader = Buffer.alloc(20);
        startHeader.writeBigUInt64LE(nextHeaderOffset, 0);
        startHeader.writeBigUInt64LE(nextHeaderSize, 8);
        startHeader.writeUInt32LE(nextHeaderCRC, 16);

        const startHeaderCRC = crc32(startHeader);

        // Build signature header
        const signatureHeader = Buffer.alloc(32);
        SIGNATURE.copy(signatureHeader, 0);
        signatureHeader[6] = VERSION_MAJOR;
        signatureHeader[7] = VERSION_MINOR;
        signatureHeader.writeUInt32LE(startHeaderCRC, 8);
        startHeader.copy(signatureHeader, 12);

        // The 7z header is stored uncompressed (kHeader, not kEncodedHeader),
        // which every reader supports.
        return Buffer.concat([signatureHeader, packed, header]);
    }

    /**
     * When a password is set, encrypt the LZMA stream with AES-256-CBC after
     * zero-padding it to a 16-byte boundary, and return the ciphertext plus the
     * coder's property blob. Otherwise return the stream unchanged.
     */
    private maybeEncrypt(stream: Buffer): {packed: Buffer; aes?: {props: Buffer}} {
        if (!this.password) {
            return {packed: stream};
        }

        // 7-Zip's own archives use an IV only (no salt); match that.
        const iv = crypto.randomBytes(AES_BLOCK_SIZE);
        const key = deriveAesKey(this.password, Buffer.alloc(0), AES_NUM_CYCLES_POWER);

        const padLength = (AES_BLOCK_SIZE - (stream.length % AES_BLOCK_SIZE)) % AES_BLOCK_SIZE;
        const padded = Buffer.concat([stream, Buffer.alloc(padLength, 0)]);

        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        cipher.setAutoPadding(false);
        const packed = Buffer.concat([cipher.update(padded), cipher.final()]);

        // AES coder properties: a flags byte (numCyclesPower + IV-present bit),
        // then a nibble-packed size byte, then the IV. No salt -> salt bit clear
        // and the high nibble is 0.
        const flags = AES_NUM_CYCLES_POWER | AES_PROP_IV_PRESENT;
        const sizes = (iv.length - 1) & 0x0f;
        const props = Buffer.concat([Buffer.from([flags, sizes]), iv]);

        return {packed, aes: {props}};
    }

    /**
     * Build the 7z header with file metadata.
     */
    private buildHeader(
        lzmaProps: Buffer,
        packedSize: number,
        lzmaStreamSize: number,
        unpackedSize: number,
        aes?: {props: Buffer}
    ): Buffer {
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
    private buildMainStreamsInfo(
        lzmaProps: Buffer,
        packedSize: number,
        lzmaStreamSize: number,
        unpackedSize: number,
        aes?: {props: Buffer}
    ): Buffer {
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
    private buildPackInfo(packedSize: number): Buffer {
        return Buffer.concat([
            Buffer.from([kPackInfo]),
            encode7zNumber(0), // pack position
            encode7zNumber(1), // number of pack streams
            Buffer.from([kSize]),
            encode7zNumber(packedSize),
            Buffer.from([kEnd])
        ]);
    }

    /**
     * Build a single coder record: flags byte (id size | attributes), id, and
     * the property length + bytes.
     */
    private buildCoder(id: Buffer, props: Buffer): Buffer {
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
    private buildUnpackInfo(
        lzmaProps: Buffer,
        lzmaStreamSize: number,
        unpackedSize: number,
        aes?: {props: Buffer}
    ): Buffer {
        const lzmaCoder = this.buildCoder(LZMA_CODEC_ID, lzmaProps);

        let folder: Buffer;
        let coderUnpackSizes: Buffer;

        if (aes) {
            const aesCoder = this.buildCoder(AES_CODEC_ID, aes.props);
            folder = Buffer.concat([
                encode7zNumber(2), // number of coders
                aesCoder, // coder 0 (in 0, out 0)
                lzmaCoder, // coder 1 (in 1, out 1)
                // bind pair: LZMA input (in-stream 1) <- AES output (out-stream 0).
                encode7zNumber(1),
                encode7zNumber(0)
            ]);
            // Out-stream order: AES output then LZMA output.
            coderUnpackSizes = Buffer.concat([encode7zNumber(lzmaStreamSize), encode7zNumber(unpackedSize)]);
        } else {
            folder = Buffer.concat([
                encode7zNumber(1), // number of coders
                lzmaCoder
            ]);
            coderUnpackSizes = encode7zNumber(unpackedSize);
        }

        return Buffer.concat([
            Buffer.from([kUnpackInfo]),
            Buffer.from([kFolder]),
            encode7zNumber(1), // number of folders
            Buffer.from([0]), // external = 0 (folders stored inline)
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
    private buildSubStreamsInfo(): Buffer {
        const parts: Buffer[] = [Buffer.from([kSubStreamsInfo])];

        // Number of unpacked substreams in the (single) folder.
        parts.push(Buffer.from([kNumUnpackStream]));
        parts.push(encode7zNumber(this.files.length));

        // Sizes: all but the last substream (the last is inferred from the
        // folder's total unpack size). Only emitted when >1 file.
        if (this.files.length > 1) {
            parts.push(Buffer.from([kSize]));
            for (let i = 0; i < this.files.length - 1; i++) {
                parts.push(encode7zNumber(this.files[i].data.length));
            }
        }

        // CRC for every substream (none are known from the folder itself).
        parts.push(Buffer.from([kCRC]));
        parts.push(Buffer.from([1])); // all defined
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
    private buildFilesInfo(): Buffer {
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
    private buildFileNames(): Buffer {
        const namesData: Buffer[] = [];
        for (const file of this.files) {
            // 7z stores forward-slash paths; both 7-Zip (Windows) and p7zip
            // read them, and they extract to nested directories on every OS.
            const name = file.entry.relativePath.replace(/\\/g, '/');
            namesData.push(Buffer.from(name, 'utf16le'));
            namesData.push(Buffer.from([0, 0])); // UTF-16LE null terminator
        }
        const allNames = Buffer.concat(namesData);

        return Buffer.concat([
            Buffer.from([kNames]),
            encode7zNumber(allNames.length + 1), // + external flag byte
            Buffer.from([0]), // external = 0 (names inline)
            allNames
        ]);
    }

    /**
     * Build modification times section.
     */
    private buildMTimes(): Buffer {
        const parts: Buffer[] = [Buffer.from([kMTime])];

        // Size: 1 byte "all defined" + 1 byte external + 8 bytes per file.
        const dataSize = 1 + 1 + 8 * this.files.length;
        parts.push(encode7zNumber(dataSize));
        parts.push(Buffer.from([1])); // all defined
        parts.push(Buffer.from([0])); // external = 0

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
    private buildAttributes(): Buffer {
        const parts: Buffer[] = [Buffer.from([kAttributes])];

        // Size: 1 byte "all defined" + 1 byte external + 4 bytes per file.
        const dataSize = 1 + 1 + 4 * this.files.length;
        parts.push(encode7zNumber(dataSize));
        parts.push(Buffer.from([1])); // all defined
        parts.push(Buffer.from([0])); // external = 0

        for (const file of this.files) {
            const buf = Buffer.alloc(4);
            // Directories never reach here (addFile skips them).
            /* c8 ignore next */
            const attr = file.entry.isDirectory ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_ARCHIVE;
            buf.writeUInt32LE(attr);
            parts.push(buf);
        }

        return Buffer.concat(parts);
    }
}
