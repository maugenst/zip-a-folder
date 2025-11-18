"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NativeTar = void 0;
const tslib_1 = require("tslib");
const utils_1 = require("../core/utils");
function createTarHeader(name, size, mtimeSeconds, mode, isDirectory) {
    const buf = Buffer.alloc(512, 0);
    (0, utils_1.writeString)(buf, name, 0, 100);
    (0, utils_1.writeOctal)(buf, mode & 0o7777, 100, 8);
    (0, utils_1.writeOctal)(buf, 0, 108, 8);
    (0, utils_1.writeOctal)(buf, 0, 116, 8);
    (0, utils_1.writeOctal)(buf, size, 124, 12);
    (0, utils_1.writeOctal)(buf, Math.floor(mtimeSeconds), 136, 12);
    for (let i = 148; i < 156; i++) {
        buf[i] = 0x20;
    }
    buf[156] = (isDirectory ? '5' : '0').charCodeAt(0);
    (0, utils_1.writeString)(buf, 'ustar', 257, 6);
    (0, utils_1.writeString)(buf, '00', 263, 2);
    let sum = 0;
    for (let i = 0; i < 512; i++) {
        sum += buf[i];
    }
    (0, utils_1.writeOctal)(buf, sum, 148, 8);
    return buf;
}
class NativeTar {
    constructor(stream) {
        this.stream = stream;
    }
    addDirectory(entry) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let name = entry.relativePath.replace(/\\/g, '/');
            if (!name.endsWith('/')) {
                name += '/';
            }
            const header = createTarHeader(name, 0, entry.stat.mtime.getTime() / 1000, entry.stat.mode, true);
            yield (0, utils_1.writeToStream)(this.stream, header);
        });
    }
    addFile(entry) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const name = entry.relativePath.replace(/\\/g, '/');
            const data = yield fs.promises.readFile(entry.fsPath);
            const header = createTarHeader(name, data.length, entry.stat.mtime.getTime() / 1000, entry.stat.mode, false);
            yield (0, utils_1.writeToStream)(this.stream, header);
            yield (0, utils_1.writeToStream)(this.stream, data);
            const remainder = data.length % 512;
            if (remainder !== 0) {
                const padding = Buffer.alloc(512 - remainder, 0);
                yield (0, utils_1.writeToStream)(this.stream, padding);
            }
        });
    }
    finalize() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const block = Buffer.alloc(512, 0);
            yield (0, utils_1.writeToStream)(this.stream, block);
            yield (0, utils_1.writeToStream)(this.stream, block);
        });
    }
}
exports.NativeTar = NativeTar;
const fs = tslib_1.__importStar(require("fs"));
//# sourceMappingURL=NativeTar.js.map