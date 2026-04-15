// lib/7z/Native7z.ts
import * as fs from 'fs';
// Import LZMA using require for CommonJS compatibility
// @ts-ignore - lzma doesn't have types
import LZMA from 'lzma';
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
const kFolder = 0x0b;
const kCodersUnpackSize = 0x0c;
const kNumUnpackStream = 0x0d;
const kNames = 0x11;
const kMTime = 0x14;
const kAttributes = 0x15;

// LZMA codec ID
const LZMA_CODEC_ID = Buffer.from([0x03, 0x01, 0x01]);

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
 * Simple 7z number encoding (used for headers)
 */
/* c8 ignore start - large number encoding only triggered with files >127 bytes compressed */
function encode7zNumber(value: number): Buffer {
    if (value < 0x80) {
        return Buffer.from([value]);
    }

    // For simplicity, encode as 8-byte little-endian for larger values
    const buf = Buffer.alloc(9);
    buf[0] = 0xff; // Marker for 8-byte value
    buf.writeBigUInt64LE(BigInt(value), 1);
    return buf;
}
/* c8 ignore stop */

/**
 * Write Windows FILETIME (100-nanosecond intervals since 1601-01-01)
 */
function dateToFiletime(date: Date): bigint {
    // Difference between 1601 and 1970 in milliseconds
    const EPOCH_DIFF = BigInt(11644473600000);
    const ms = BigInt(date.getTime()) + EPOCH_DIFF;
    return ms * BigInt(10000); // Convert to 100-nanosecond intervals
}

interface FileData {
    entry: FileEntry;
    data: Buffer;
    compressedData: Buffer;
}

/**
 * Native 7z archive writer using pure JavaScript LZMA compression.
 */
export class Native7z {
    private files: FileData[] = [];
    private compressionLevel: number;

    /**
     * @param compressionLevel LZMA compression level 1-9 (default: 5)
     */
    constructor(compressionLevel = 5) {
        this.compressionLevel = Math.max(1, Math.min(9, compressionLevel));
    }

    /**
     * Add a file to the archive from filesystem.
     */
    async addFile(entry: FileEntry): Promise<void> {
        if (entry.isDirectory) {
            // 7z handles empty directories differently - we'll skip them for now
            // as most 7z archives don't include empty directories
            return;
        }

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
    private compressLzma(data: Buffer): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            LZMA.compress(data, this.compressionLevel, (result: number[] | Error, error?: Error) => {
                /* c8 ignore start - LZMA error handling is hard to trigger in tests */
                if (error || result instanceof Error) {
                    reject(error || result);
                    return;
                }
                /* c8 ignore stop */
                // Result is signed bytes, convert to unsigned Buffer
                const unsigned = (result as number[]).map((b) => (b < 0 ? b + 256 : b));
                resolve(Buffer.from(unsigned));
            });
        });
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
        // Concatenate all compressed data
        const packedData = Buffer.concat(this.files.map((f) => f.compressedData));

        // Build the header
        const header = this.buildHeader();

        // Compress the header with LZMA
        const compressedHeader = await this.compressLzma(header);

        // Build start header
        const nextHeaderOffset = BigInt(packedData.length);
        const nextHeaderSize = BigInt(compressedHeader.length);
        const nextHeaderCRC = crc32(compressedHeader);

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

        // Combine all parts
        return Buffer.concat([signatureHeader, packedData, compressedHeader]);
    }

    /**
     * Build the 7z header with file metadata.
     */
    private buildHeader(): Buffer {
        const parts: Buffer[] = [];

        // Header property ID
        parts.push(Buffer.from([kHeader]));

        // MainStreamsInfo
        parts.push(this.buildMainStreamsInfo());

        // FilesInfo
        parts.push(this.buildFilesInfo());

        // End marker
        parts.push(Buffer.from([kEnd]));

        return Buffer.concat(parts);
    }

    /**
     * Build MainStreamsInfo section.
     */
    private buildMainStreamsInfo(): Buffer {
        const parts: Buffer[] = [];

        parts.push(Buffer.from([kMainStreamsInfo]));

        // PackInfo
        parts.push(this.buildPackInfo());

        // UnpackInfo
        parts.push(this.buildUnpackInfo());

        // SubStreamsInfo
        parts.push(this.buildSubStreamsInfo());

        parts.push(Buffer.from([kEnd]));

        return Buffer.concat(parts);
    }

    /**
     * Build PackInfo section (packed/compressed sizes).
     */
    private buildPackInfo(): Buffer {
        const parts: Buffer[] = [];

        parts.push(Buffer.from([kPackInfo]));

        // Pack position (offset from start of packed data)
        parts.push(encode7zNumber(0));

        // Number of pack streams
        parts.push(encode7zNumber(this.files.length));

        // Sizes
        parts.push(Buffer.from([kSize]));
        for (const file of this.files) {
            parts.push(encode7zNumber(file.compressedData.length));
        }

        parts.push(Buffer.from([kEnd]));

        return Buffer.concat(parts);
    }

    /**
     * Build UnpackInfo section (codec and uncompressed sizes).
     */
    private buildUnpackInfo(): Buffer {
        const parts: Buffer[] = [];

        parts.push(Buffer.from([kUnpackInfo]));

        // Folder (codec info)
        parts.push(Buffer.from([kFolder]));

        // Number of folders (one per file for simplicity)
        parts.push(encode7zNumber(this.files.length));

        // External flag (0 = inline)
        parts.push(Buffer.from([0]));

        // Folder info for each file
        for (const _file of this.files) {
            // Number of coders
            parts.push(Buffer.from([1]));

            // Coder info
            // First byte: flags + codec ID size
            // bit 4 = has attributes, bit 5 = has more streams
            const coderFlags = LZMA_CODEC_ID.length; // Just codec ID size, no extra flags
            parts.push(Buffer.from([coderFlags]));
            parts.push(LZMA_CODEC_ID);
        }

        // CodersUnpackSize
        parts.push(Buffer.from([kCodersUnpackSize]));
        for (const file of this.files) {
            parts.push(encode7zNumber(file.data.length));
        }

        parts.push(Buffer.from([kEnd]));

        return Buffer.concat(parts);
    }

    /**
     * Build SubStreamsInfo section.
     */
    private buildSubStreamsInfo(): Buffer {
        const parts: Buffer[] = [];

        parts.push(Buffer.from([kSubStreamsInfo]));

        // NumUnpackStream (number of files per folder)
        parts.push(Buffer.from([kNumUnpackStream]));
        for (let i = 0; i < this.files.length; i++) {
            parts.push(encode7zNumber(1));
        }

        parts.push(Buffer.from([kEnd]));

        return Buffer.concat(parts);
    }

    /**
     * Build FilesInfo section (file names, attributes, times).
     */
    private buildFilesInfo(): Buffer {
        const parts: Buffer[] = [];

        parts.push(Buffer.from([kFilesInfo]));

        // Number of files
        parts.push(encode7zNumber(this.files.length));

        // File names
        parts.push(this.buildFileNames());

        // Modification times
        parts.push(this.buildMTimes());

        // Windows attributes
        parts.push(this.buildAttributes());

        parts.push(Buffer.from([kEnd]));

        return Buffer.concat(parts);
    }

    /**
     * Build file names section (UTF-16LE encoded).
     */
    private buildFileNames(): Buffer {
        const parts: Buffer[] = [];

        parts.push(Buffer.from([kNames]));

        // Build names data (UTF-16LE, null-terminated)
        const namesData: Buffer[] = [];
        for (const file of this.files) {
            // Convert to Windows-style path (backslashes)
            const name = file.entry.relativePath.replace(/\//g, '\\');
            // Encode as UTF-16LE
            const nameBuffer = Buffer.from(name, 'utf16le');
            namesData.push(nameBuffer);
            namesData.push(Buffer.from([0, 0])); // Null terminator (UTF-16LE)
        }

        const allNames = Buffer.concat(namesData);

        // Size of names section (including external flag byte)
        parts.push(encode7zNumber(allNames.length + 1));

        // External flag (0 = data inline)
        parts.push(Buffer.from([0]));

        // Names data
        parts.push(allNames);

        return Buffer.concat(parts);
    }

    /**
     * Build modification times section.
     */
    private buildMTimes(): Buffer {
        const parts: Buffer[] = [];

        parts.push(Buffer.from([kMTime]));

        // Size: 1 byte flags + 1 byte "all defined" + 1 byte external + 8 bytes per file
        const dataSize = 1 + 1 + 8 * this.files.length;
        parts.push(encode7zNumber(dataSize));

        // All files have mtime defined
        parts.push(Buffer.from([1])); // AllAreDefined = true

        // External flag
        parts.push(Buffer.from([0]));

        // Times (Windows FILETIME)
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
        const parts: Buffer[] = [];

        parts.push(Buffer.from([kAttributes]));

        // Size: 1 byte flags + 1 byte external + 4 bytes per file
        const dataSize = 1 + 1 + 4 * this.files.length;
        parts.push(encode7zNumber(dataSize));

        // All files have attributes defined
        parts.push(Buffer.from([1])); // AllAreDefined = true

        // External flag
        parts.push(Buffer.from([0]));

        // Attributes (simple: archive attribute for files)
        for (const file of this.files) {
            const buf = Buffer.alloc(4);
            // Windows FILE_ATTRIBUTE_ARCHIVE = 0x20
            // For directories: FILE_ATTRIBUTE_DIRECTORY = 0x10
            // Note: isDirectory is always false here because addFile() skips directories.
            /* c8 ignore next */
            const attr = file.entry.isDirectory ? 0x10 : 0x20;
            buf.writeUInt32LE(attr);
            parts.push(buf);
        }

        return Buffer.concat(parts);
    }
}
