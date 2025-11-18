import { writeOctal, writeString, writeToStream } from '../core/utils';
function createTarHeader(name, size, mtimeSeconds, mode, isDirectory) {
    const buf = Buffer.alloc(512, 0);
    writeString(buf, name, 0, 100);
    writeOctal(buf, mode & 0o7777, 100, 8);
    writeOctal(buf, 0, 108, 8);
    writeOctal(buf, 0, 116, 8);
    writeOctal(buf, size, 124, 12);
    writeOctal(buf, Math.floor(mtimeSeconds), 136, 12);
    for (let i = 148; i < 156; i++) {
        buf[i] = 0x20;
    }
    buf[156] = (isDirectory ? '5' : '0').charCodeAt(0);
    writeString(buf, 'ustar', 257, 6);
    writeString(buf, '00', 263, 2);
    let sum = 0;
    for (let i = 0; i < 512; i++) {
        sum += buf[i];
    }
    writeOctal(buf, sum, 148, 8);
    return buf;
}
export class NativeTar {
    stream;
    constructor(stream) {
        this.stream = stream;
    }
    async addDirectory(entry) {
        let name = entry.relativePath.replace(/\\/g, '/');
        if (!name.endsWith('/')) {
            name += '/';
        }
        const header = createTarHeader(name, 0, entry.stat.mtime.getTime() / 1000, entry.stat.mode, true);
        await writeToStream(this.stream, header);
    }
    async addFile(entry) {
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
    async finalize() {
        const block = Buffer.alloc(512, 0);
        await writeToStream(this.stream, block);
        await writeToStream(this.stream, block);
    }
}
import * as fs from 'fs';
//# sourceMappingURL=NativeTar.js.map