// src/tar/NativeTar.ts
import {FileEntry} from '../core/types';
import {writeOctal, writeString, writeToStream} from '../core/utils';

/**
 * Create a 512-byte TAR header block for a file or directory.
 */
function createTarHeader(
    name: string,
    size: number,
    mtimeSeconds: number,
    mode: number,
    typeflag: '0' | '5' | 'x'
): Buffer {
    const buf = Buffer.alloc(512, 0);

    // Name (100 bytes)
    writeString(buf, name, 0, 100);
    // Mode (8 bytes, octal)
    writeOctal(buf, mode & 0o7777, 100, 8);
    // UID / GID (8 bytes each, octal) => 0
    writeOctal(buf, 0, 108, 8);
    writeOctal(buf, 0, 116, 8);
    // Size (12 bytes, octal)
    writeOctal(buf, size, 124, 12);
    // Mtime (12 bytes, octal)
    writeOctal(buf, Math.floor(mtimeSeconds), 136, 12);

    // Checksum: initially filled with spaces.
    for (let i = 148; i < 156; i++) {
        buf[i] = 0x20;
    }

    // Typeflag (1 byte)
    buf[156] = typeflag.charCodeAt(0);

    // Magic + version
    writeString(buf, 'ustar', 257, 6);
    writeString(buf, '00', 263, 2);

    // Compute checksum
    let sum = 0;
    for (let i = 0; i < 512; i++) {
        sum += buf[i];
    }
    writeOctal(buf, sum, 148, 8);

    return buf;
}

/**
 * A PAX record "<length> path=<name>\n", where length counts the whole record.
 */
function paxPathRecord(name: string): Buffer {
    const body = ` path=${name}\n`;
    const bodyLength = Buffer.byteLength(body);
    let length = bodyLength + 1;
    while (String(length).length + bodyLength !== length) {
        length = String(length).length + bodyLength;
    }
    return Buffer.from(`${length}${body}`, 'utf8');
}

/**
 * Minimal TAR writer used to build tar streams for .tar / .tgz files.
 */
export class NativeTar {
    private stream: NodeJS.WritableStream;

    constructor(stream: NodeJS.WritableStream) {
        this.stream = stream;
    }

    /**
     * The ustar name field holds 100 bytes; a longer path goes in a PAX header
     * before the entry, which tar readers use instead of the cut name.
     */
    private async writeLongName(name: string, mtimeSeconds: number): Promise<void> {
        if (Buffer.byteLength(name) <= 100) {
            return;
        }
        const record = paxPathRecord(name);
        await writeToStream(this.stream, createTarHeader('PaxHeader', record.length, mtimeSeconds, 0o644, 'x'));
        await this.writeData(record);
    }

    private async writeData(data: Buffer): Promise<void> {
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
    public async addDirectory(entry: FileEntry): Promise<void> {
        let name = entry.relativePath.replace(/\\/g, '/');
        if (!name.endsWith('/')) {
            name += '/';
        }
        const mtime = entry.stat.mtime.getTime() / 1000;
        await this.writeLongName(name, mtime);
        await writeToStream(this.stream, createTarHeader(name, 0, mtime, entry.stat.mode, '5'));
    }

    /**
     * Add a file entry (header + file data + padding to 512 bytes).
     */
    public async addFile(entry: FileEntry): Promise<void> {
        const name = entry.relativePath.replace(/\\/g, '/');
        const data = await fs.promises.readFile(entry.fsPath);
        const mtime = entry.stat.mtime.getTime() / 1000;

        await this.writeLongName(name, mtime);
        await writeToStream(this.stream, createTarHeader(name, data.length, mtime, entry.stat.mode, '0'));
        await this.writeData(data);
    }

    /**
     * Finalize the TAR archive by writing two 512-byte zero blocks.
     */
    public async finalize(): Promise<void> {
        const block = Buffer.alloc(512, 0);
        await writeToStream(this.stream, block);
        await writeToStream(this.stream, block);
    }
}

// Need fs import here
import * as fs from 'fs';
