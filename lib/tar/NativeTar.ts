// src/tar/NativeTar.ts
import {FileEntry} from '../core/types';
import {writeOctal, writeString, writeToStream} from '../core/utils';

/**
 * Create a 512-byte TAR header block for a file or directory.
 */
function createTarHeader(name: string, size: number, mtimeSeconds: number, mode: number, isDirectory: boolean): Buffer {
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
    buf[156] = (isDirectory ? '5' : '0').charCodeAt(0);

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
 * Minimal TAR writer used to build tar streams for .tar / .tgz files.
 */
export class NativeTar {
    private stream: NodeJS.WritableStream;

    constructor(stream: NodeJS.WritableStream) {
        this.stream = stream;
    }

    /**
     * Add a directory entry (no data, only header).
     */
    public async addDirectory(entry: FileEntry): Promise<void> {
        let name = entry.relativePath.replace(/\\/g, '/');
        /* istanbul ignore next */
        if (!name.endsWith('/')) {
            name += '/';
        }
        const header = createTarHeader(name, 0, entry.stat.mtime.getTime() / 1000, entry.stat.mode, true);
        await writeToStream(this.stream, header);
    }

    /**
     * Add a file entry (header + file data + padding to 512 bytes).
     */
    public async addFile(entry: FileEntry): Promise<void> {
        const name = entry.relativePath.replace(/\\/g, '/');
        const data = await fs.promises.readFile(entry.fsPath);
        const header = createTarHeader(name, data.length, entry.stat.mtime.getTime() / 1000, entry.stat.mode, false);

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
    public async finalize(): Promise<void> {
        const block = Buffer.alloc(512, 0);
        await writeToStream(this.stream, block);
        await writeToStream(this.stream, block);
    }
}

// Need fs import here
import * as fs from 'fs';
