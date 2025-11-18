// src/zip/NativeZip.ts
import * as fs from 'fs';
import * as zlib from 'zlib';
import {crc32, dateToDosDate, dateToDosTime, writeUInt64LE} from '../core/utils';

/**
 * Low-level ZIP entry representation.
 */
class ZipEntry {
    public name: string;
    public isDirectory: boolean;
    public date: Date;

    public crc32: number;
    public compressedSize: number;
    public uncompressedSize: number;
    public compressionMethod: number;
    public compressedData: Buffer;

    public localHeaderOffset = 0;

    constructor(params: {
        name: string;
        isDirectory: boolean;
        date: Date;
        crc32: number;
        compressedSize: number;
        uncompressedSize: number;
        compressionMethod: number;
        compressedData: Buffer;
    }) {
        this.name = params.name;
        this.isDirectory = params.isDirectory;
        this.date = params.date;
        this.crc32 = params.crc32;
        this.compressedSize = params.compressedSize;
        this.uncompressedSize = params.uncompressedSize;
        this.compressionMethod = params.compressionMethod;
        this.compressedData = params.compressedData;
    }
}

/**
 * Options for the low-level NativeZip writer.
 */
export interface NativeZipOptions {
    comment?: string;
    forceLocalTime?: boolean;
    forceZip64?: boolean;
    namePrependSlash?: boolean;
    store?: boolean;
    zlib?: zlib.ZlibOptions;
}

/**
 * Native ZIP writer using only Node's built-in modules.
 *
 * - Supports standard ZIP up to 4GB.
 * - Automatically enables ZIP64 structures when needed (size/offset/entry-count overflow),
 *   or when forceZip64 is set.
 * - Directories are stored as entries with trailing "/".
 */
export class NativeZip {
    private entries: ZipEntry[] = [];
    private comment?: string;
    private useLocalTime: boolean;
    private forceZip64: boolean;
    private store: boolean;
    private zlibOptions?: zlib.ZlibOptions;

    /* istanbul ignore next */
    constructor(options: NativeZipOptions = {}) {
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
     */
    public addDirectoryEntry(archivePath: string, date: Date): void {
        let name = archivePath.replace(/\\/g, '/');
        /* istanbul ignore next */
        if (!name.endsWith('/')) {
            name += '/';
        }
        this.entries.push(
            new ZipEntry({
                name,
                isDirectory: true,
                date,
                crc32: 0,
                compressedSize: 0,
                uncompressedSize: 0,
                compressionMethod: 0,
                compressedData: Buffer.alloc(0)
            })
        );
    }

    /**
     * Add a file from the filesystem to the ZIP archive.
     * @param filePath    Physical file path on disk.
     * @param archivePath Path inside the archive.
     * @param date        Modification date.
     */
    public async addFileFromFs(filePath: string, archivePath: string, date: Date): Promise<void> {
        const name = archivePath.replace(/\\/g, '/');
        const data = await fs.promises.readFile(filePath);
        const sum = crc32(data);

        let compressed: Buffer;
        let method: number;

        if (this.store) {
            compressed = data;
            method = 0; // STORE
        } else {
            compressed = zlib.deflateRawSync(data, this.zlibOptions);
            method = 8; // DEFLATE
        }

        this.entries.push(
            new ZipEntry({
                name,
                isDirectory: false,
                date,
                crc32: sum,
                compressedSize: compressed.length,
                uncompressedSize: data.length,
                compressionMethod: method,
                compressedData: compressed
            })
        );
    }

    /**
     * Write the ZIP archive to a writable stream.
     * Handles ZIP64 automatically when required.
     */
    public writeToStream(stream: NodeJS.WritableStream): Promise<void> {
        return new Promise((resolve, reject) => {
            stream.once('error', reject);

            try {
                let offset = 0;
                const centralDirParts: Buffer[] = [];
                const commentBuffer = this.comment ? Buffer.from(this.comment, 'utf8') : Buffer.alloc(0);

                let useZip64 = this.forceZip64;

                // Write local file headers + data, build central directory entries in memory.
                for (const entry of this.entries) {
                    const nameBuffer = Buffer.from(entry.name, 'utf8');
                    const dosTime = dateToDosTime(entry.date, this.useLocalTime);
                    const dosDate = dateToDosDate(entry.date, this.useLocalTime);

                    const needsZip64Sizes =
                        entry.compressedSize >= 0xffffffff || entry.uncompressedSize >= 0xffffffff || this.forceZip64;
                    const needsZip64Offset = offset >= 0xffffffff || this.forceZip64;
                    const needsZip64Entry = needsZip64Sizes || needsZip64Offset;

                    if (needsZip64Entry) {
                        useZip64 = true;
                    }

                    // --- Local header extra field (ZIP64 if needed for sizes) ---
                    let localExtra = Buffer.alloc(0);
                    if (needsZip64Sizes) {
                        // ID(2) + size(2) + uncompressed(8) + compressed(8) = 20 bytes
                        const extra = Buffer.alloc(4 + 8 + 8);
                        let q = 0;
                        extra.writeUInt16LE(0x0001, q);
                        q += 2; // header ID
                        extra.writeUInt16LE(16, q);
                        q += 2; // data size
                        writeUInt64LE(extra, entry.uncompressedSize, q);
                        q += 8;
                        writeUInt64LE(extra, entry.compressedSize, q);
                        q += 8;
                        localExtra = extra;
                    }

                    // --- Local file header ---
                    const localHeader = Buffer.alloc(30);
                    let p = 0;

                    // signature
                    localHeader.writeUInt32LE(0x04034b50, p);
                    p += 4;
                    // version needed to extract
                    localHeader.writeUInt16LE(useZip64 ? 45 : 20, p);
                    p += 2;
                    // general purpose bit flag
                    localHeader.writeUInt16LE(0x0000, p);
                    p += 2;
                    // compression method
                    localHeader.writeUInt16LE(entry.compressionMethod, p);
                    p += 2;
                    // dos time/date
                    localHeader.writeUInt16LE(dosTime, p);
                    p += 2;
                    localHeader.writeUInt16LE(dosDate, p);
                    p += 2;
                    // crc32
                    localHeader.writeUInt32LE(entry.crc32 >>> 0, p);
                    p += 4;
                    // compressed size / uncompressed size (may be 0xffffffff if ZIP64)
                    if (needsZip64Sizes) {
                        localHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                        localHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                    } else {
                        localHeader.writeUInt32LE(entry.compressedSize >>> 0, p);
                        p += 4;
                        localHeader.writeUInt32LE(entry.uncompressedSize >>> 0, p);
                        p += 4;
                    }
                    // name length
                    localHeader.writeUInt16LE(nameBuffer.length, p);
                    p += 2;
                    // extra length
                    localHeader.writeUInt16LE(localExtra.length, p);
                    p += 2;

                    entry.localHeaderOffset = offset;

                    // Write local header + name + extra + data
                    stream.write(localHeader);
                    stream.write(nameBuffer);
                    if (localExtra.length > 0) {
                        stream.write(localExtra);
                    }
                    offset += localHeader.length + nameBuffer.length + localExtra.length;

                    if (entry.compressedData.length > 0) {
                        stream.write(entry.compressedData);
                        offset += entry.compressedData.length;
                    }

                    // --- Central directory header for this entry ---
                    const centralHeader = Buffer.alloc(46);
                    p = 0;

                    const centralNeedsZip64Sizes = needsZip64Sizes;
                    const centralNeedsZip64Offset = needsZip64Offset;
                    const centralNeedsZip64 = centralNeedsZip64Sizes || centralNeedsZip64Offset;

                    // central file header signature
                    centralHeader.writeUInt32LE(0x02014b50, p);
                    p += 4;
                    // version made by
                    centralHeader.writeUInt16LE(useZip64 ? 45 : 20, p);
                    p += 2;
                    // version needed to extract
                    centralHeader.writeUInt16LE(useZip64 ? 45 : 20, p);
                    p += 2;
                    // general purpose bit flag
                    centralHeader.writeUInt16LE(0x0000, p);
                    p += 2;
                    // compression method
                    centralHeader.writeUInt16LE(entry.compressionMethod, p);
                    p += 2;
                    // dos time/date
                    centralHeader.writeUInt16LE(dosTime, p);
                    p += 2;
                    centralHeader.writeUInt16LE(dosDate, p);
                    p += 2;
                    // crc32
                    centralHeader.writeUInt32LE(entry.crc32 >>> 0, p);
                    p += 4;

                    // sizes
                    if (centralNeedsZip64Sizes) {
                        centralHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                        centralHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                    } else {
                        centralHeader.writeUInt32LE(entry.compressedSize >>> 0, p);
                        p += 4;
                        centralHeader.writeUInt32LE(entry.uncompressedSize >>> 0, p);
                        p += 4;
                    }

                    // name length
                    centralHeader.writeUInt16LE(nameBuffer.length, p);
                    p += 2;

                    // We'll append ZIP64 extra if necessary.
                    let centralExtra = Buffer.alloc(0);
                    if (centralNeedsZip64) {
                        // ID(2) + size(2) + uncompressed(8) + compressed(8) + offset(8) = 30
                        const extraSize = 8 + 8 + 8;
                        const extra = Buffer.alloc(4 + extraSize);
                        let q = 0;
                        extra.writeUInt16LE(0x0001, q);
                        q += 2; // header ID
                        extra.writeUInt16LE(extraSize, q);
                        q += 2; // data size
                        writeUInt64LE(extra, entry.uncompressedSize, q);
                        q += 8;
                        writeUInt64LE(extra, entry.compressedSize, q);
                        q += 8;
                        writeUInt64LE(extra, entry.localHeaderOffset, q);
                        q += 8;
                        centralExtra = extra;
                    }

                    // extra length
                    centralHeader.writeUInt16LE(centralExtra.length, p);
                    p += 2;
                    // comment length
                    centralHeader.writeUInt16LE(0, p);
                    p += 2;
                    // disk number start
                    centralHeader.writeUInt16LE(0, p);
                    p += 2;
                    // internal file attributes
                    centralHeader.writeUInt16LE(0, p);
                    p += 2;
                    // external file attributes
                    const extAttr = entry.isDirectory ? 0x10 : 0x00;
                    centralHeader.writeUInt32LE(extAttr, p);
                    p += 4;
                    // relative offset of local header (may be 0xffffffff when ZIP64)
                    if (centralNeedsZip64Offset) {
                        centralHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                    } else {
                        centralHeader.writeUInt32LE(entry.localHeaderOffset >>> 0, p);
                        p += 4;
                    }

                    centralDirParts.push(centralHeader, nameBuffer);
                    if (centralExtra.length > 0) {
                        centralDirParts.push(centralExtra);
                    }
                }

                const startOfCentralDir = offset;
                const centralDirectoryBuffer = Buffer.concat(centralDirParts);
                const sizeOfCentralDir = centralDirectoryBuffer.length;
                const totalEntries = this.entries.length;

                // Overflow checks for ZIP64
                /* istanbul ignore next */
                if (startOfCentralDir >= 0xffffffff || sizeOfCentralDir >= 0xffffffff || totalEntries >= 0xffff) {
                    useZip64 = true;
                }

                // Write central directory
                stream.write(centralDirectoryBuffer);
                const offsetAfterCentralDir = startOfCentralDir + sizeOfCentralDir;

                if (useZip64) {
                    // --- ZIP64 End of Central Directory Record ---
                    const zip64Eocd = Buffer.alloc(56);
                    let pz = 0;
                    // signature
                    zip64Eocd.writeUInt32LE(0x06064b50, pz);
                    pz += 4;
                    // size of remaining record (size - 12). Here: 44.
                    writeUInt64LE(zip64Eocd, 44, pz);
                    pz += 8;
                    // version made by / needed to extract
                    zip64Eocd.writeUInt16LE(45, pz);
                    pz += 2;
                    zip64Eocd.writeUInt16LE(45, pz);
                    pz += 2;
                    // number of this disk
                    zip64Eocd.writeUInt32LE(0, pz);
                    pz += 4;
                    // number of disk with start of central dir
                    zip64Eocd.writeUInt32LE(0, pz);
                    pz += 4;
                    // total entries on this disk
                    writeUInt64LE(zip64Eocd, totalEntries, pz);
                    pz += 8;
                    // total entries
                    writeUInt64LE(zip64Eocd, totalEntries, pz);
                    pz += 8;
                    // size of central directory
                    writeUInt64LE(zip64Eocd, sizeOfCentralDir, pz);
                    pz += 8;
                    // offset of start of central directory
                    writeUInt64LE(zip64Eocd, startOfCentralDir, pz);
                    pz += 8;

                    stream.write(zip64Eocd);

                    // --- ZIP64 End of Central Directory Locator ---
                    const zip64Locator = Buffer.alloc(20);
                    let pl = 0;
                    // signature
                    zip64Locator.writeUInt32LE(0x07064b50, pl);
                    pl += 4;
                    // number of disk with ZIP64 EOCD
                    zip64Locator.writeUInt32LE(0, pl);
                    pl += 4;
                    // relative offset of ZIP64 EOCD record
                    writeUInt64LE(zip64Locator, offsetAfterCentralDir, pl);
                    pl += 8;
                    // total number of disks
                    zip64Locator.writeUInt32LE(1, pl);
                    pl += 4;

                    stream.write(zip64Locator);
                }

                // --- Classic End of Central Directory Record (always written) ---
                const eocd = Buffer.alloc(22);
                let p3 = 0;

                eocd.writeUInt32LE(0x06054b50, p3);
                p3 += 4; // signature
                eocd.writeUInt16LE(0, p3);
                p3 += 2; // disk number
                eocd.writeUInt16LE(0, p3);
                p3 += 2; // disk start
                eocd.writeUInt16LE(Math.min(totalEntries, 0xffff), p3);
                p3 += 2;
                eocd.writeUInt16LE(Math.min(totalEntries, 0xffff), p3);
                p3 += 2;
                eocd.writeUInt32LE(Math.min(sizeOfCentralDir, 0xffffffff), p3);
                p3 += 4;
                eocd.writeUInt32LE(Math.min(startOfCentralDir, 0xffffffff), p3);
                p3 += 4;
                eocd.writeUInt16LE(commentBuffer.length, p3);
                p3 += 2;

                stream.write(eocd);
                if (commentBuffer.length > 0) {
                    stream.write(commentBuffer);
                }

                (stream as any).end?.(() => resolve());
            } catch (err) {
                /* istanbul ignore next */
                reject(err);
            }
        });
    }
}
