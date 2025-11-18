import * as fs from 'fs';
import * as zlib from 'zlib';
import { crc32, dateToDosDate, dateToDosTime, writeUInt64LE } from '../core/utils';
class ZipEntry {
    name;
    isDirectory;
    date;
    crc32;
    compressedSize;
    uncompressedSize;
    compressionMethod;
    compressedData;
    localHeaderOffset = 0;
    constructor(params) {
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
export class NativeZip {
    entries = [];
    comment;
    useLocalTime;
    forceZip64;
    store;
    zlibOptions;
    constructor(options = {}) {
        this.comment = options.comment;
        this.useLocalTime = options.forceLocalTime === true;
        this.forceZip64 = options.forceZip64 === true;
        this.store = options.store === true;
        this.zlibOptions = options.zlib;
    }
    addDirectoryEntry(archivePath, date) {
        let name = archivePath.replace(/\\/g, '/');
        if (!name.endsWith('/')) {
            name += '/';
        }
        this.entries.push(new ZipEntry({
            name,
            isDirectory: true,
            date,
            crc32: 0,
            compressedSize: 0,
            uncompressedSize: 0,
            compressionMethod: 0,
            compressedData: Buffer.alloc(0)
        }));
    }
    async addFileFromFs(filePath, archivePath, date) {
        const name = archivePath.replace(/\\/g, '/');
        const data = await fs.promises.readFile(filePath);
        const sum = crc32(data);
        let compressed;
        let method;
        if (this.store) {
            compressed = data;
            method = 0;
        }
        else {
            compressed = zlib.deflateRawSync(data, this.zlibOptions);
            method = 8;
        }
        this.entries.push(new ZipEntry({
            name,
            isDirectory: false,
            date,
            crc32: sum,
            compressedSize: compressed.length,
            uncompressedSize: data.length,
            compressionMethod: method,
            compressedData: compressed
        }));
    }
    writeToStream(stream) {
        return new Promise((resolve, reject) => {
            stream.once('error', reject);
            try {
                let offset = 0;
                const centralDirParts = [];
                const commentBuffer = this.comment ? Buffer.from(this.comment, 'utf8') : Buffer.alloc(0);
                let useZip64 = this.forceZip64;
                for (const entry of this.entries) {
                    const nameBuffer = Buffer.from(entry.name, 'utf8');
                    const dosTime = dateToDosTime(entry.date, this.useLocalTime);
                    const dosDate = dateToDosDate(entry.date, this.useLocalTime);
                    const needsZip64Sizes = entry.compressedSize >= 0xffffffff || entry.uncompressedSize >= 0xffffffff || this.forceZip64;
                    const needsZip64Offset = offset >= 0xffffffff || this.forceZip64;
                    const needsZip64Entry = needsZip64Sizes || needsZip64Offset;
                    if (needsZip64Entry) {
                        useZip64 = true;
                    }
                    let localExtra = Buffer.alloc(0);
                    if (needsZip64Sizes) {
                        const extra = Buffer.alloc(4 + 8 + 8);
                        let q = 0;
                        extra.writeUInt16LE(0x0001, q);
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
                    localHeader.writeUInt32LE(0x04034b50, p);
                    p += 4;
                    localHeader.writeUInt16LE(useZip64 ? 45 : 20, p);
                    p += 2;
                    localHeader.writeUInt16LE(0x0000, p);
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
                        localHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                        localHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                    }
                    else {
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
                    if (localExtra.length > 0) {
                        stream.write(localExtra);
                    }
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
                    centralHeader.writeUInt32LE(0x02014b50, p);
                    p += 4;
                    centralHeader.writeUInt16LE(useZip64 ? 45 : 20, p);
                    p += 2;
                    centralHeader.writeUInt16LE(useZip64 ? 45 : 20, p);
                    p += 2;
                    centralHeader.writeUInt16LE(0x0000, p);
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
                        centralHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                        centralHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                    }
                    else {
                        centralHeader.writeUInt32LE(entry.compressedSize >>> 0, p);
                        p += 4;
                        centralHeader.writeUInt32LE(entry.uncompressedSize >>> 0, p);
                        p += 4;
                    }
                    centralHeader.writeUInt16LE(nameBuffer.length, p);
                    p += 2;
                    let centralExtra = Buffer.alloc(0);
                    if (centralNeedsZip64) {
                        const extraSize = 8 + 8 + 8;
                        const extra = Buffer.alloc(4 + extraSize);
                        let q = 0;
                        extra.writeUInt16LE(0x0001, q);
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
                    const extAttr = entry.isDirectory ? 0x10 : 0x00;
                    centralHeader.writeUInt32LE(extAttr, p);
                    p += 4;
                    if (centralNeedsZip64Offset) {
                        centralHeader.writeUInt32LE(0xffffffff, p);
                        p += 4;
                    }
                    else {
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
                if (startOfCentralDir >= 0xffffffff || sizeOfCentralDir >= 0xffffffff || totalEntries >= 0xffff) {
                    useZip64 = true;
                }
                stream.write(centralDirectoryBuffer);
                const offsetAfterCentralDir = startOfCentralDir + sizeOfCentralDir;
                if (useZip64) {
                    const zip64Eocd = Buffer.alloc(56);
                    let pz = 0;
                    zip64Eocd.writeUInt32LE(0x06064b50, pz);
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
                    zip64Locator.writeUInt32LE(0x07064b50, pl);
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
                eocd.writeUInt32LE(0x06054b50, p3);
                p3 += 4;
                eocd.writeUInt16LE(0, p3);
                p3 += 2;
                eocd.writeUInt16LE(0, p3);
                p3 += 2;
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
                stream.end?.(() => resolve());
            }
            catch (err) {
                reject(err);
            }
        });
    }
}
//# sourceMappingURL=NativeZip.js.map