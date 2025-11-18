"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZipAFolder = exports.COMPRESSION_LEVEL = void 0;
exports.zip = zip;
exports.tar = tar;
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const zlib = tslib_1.__importStar(require("zlib"));
const types_1 = require("./core/types");
const FileCollector_1 = require("./core/FileCollector");
const utils_1 = require("./core/utils");
const NativeZip_1 = require("./zip/NativeZip");
const NativeTar_1 = require("./tar/NativeTar");
var types_2 = require("./core/types");
Object.defineProperty(exports, "COMPRESSION_LEVEL", { enumerable: true, get: function () { return types_2.COMPRESSION_LEVEL; } });
class ZipAFolder {
    static zip(source_1, targetFilePath_1) {
        return tslib_1.__awaiter(this, arguments, void 0, function* (source, targetFilePath, options = {}) {
            var _a;
            const customWS = options.customWriteStream;
            const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);
            if (!hasTargetPath && !customWS) {
                throw new Error('You must either provide a target file path or a custom write stream to write to.');
            }
            const statConcurrency = (_a = options.statConcurrency) !== null && _a !== void 0 ? _a : 4;
            const zipStore = options.store === true || options.compression === types_1.COMPRESSION_LEVEL.uncompressed;
            const zlibOptions = Object.assign({}, (options.zlib || {}));
            if (!zipStore && options.compression !== undefined) {
                switch (options.compression) {
                    case types_1.COMPRESSION_LEVEL.medium:
                        if (zlibOptions.level === undefined) {
                            zlibOptions.level = zlib.constants.Z_DEFAULT_COMPRESSION;
                        }
                        break;
                    case types_1.COMPRESSION_LEVEL.high:
                        if (zlibOptions.level === undefined) {
                            zlibOptions.level = zlib.constants.Z_BEST_COMPRESSION;
                        }
                        break;
                    default:
                        break;
                }
            }
            const zipper = new NativeZip_1.NativeZip({
                comment: options.comment,
                forceLocalTime: options.forceLocalTime,
                forceZip64: options.forceZip64,
                namePrependSlash: options.namePrependSlash,
                store: zipStore,
                zlib: zlibOptions
            });
            const cwd = process.cwd();
            const isGlob = (0, utils_1.looksLikeGlob)(source);
            let entries = [];
            if (isGlob) {
                entries = yield (0, FileCollector_1.collectGlobEntries)(source, cwd, statConcurrency);
                if (entries.length === 0) {
                    throw new Error('No glob match found');
                }
            }
            else {
                const sourceDir = path.resolve(source);
                const st = yield fs.promises.stat(sourceDir);
                if (!st.isDirectory()) {
                    throw new Error('Source must be a directory when no glob pattern is used.');
                }
                if (hasTargetPath) {
                    const targetAbs = path.resolve(targetFilePath);
                    const targetDir = path.dirname(targetAbs);
                    const normalizedSourceDir = path.resolve(sourceDir);
                    if (targetDir === normalizedSourceDir || targetDir.startsWith(normalizedSourceDir + path.sep)) {
                        throw new Error('Source and target folder must be different.');
                    }
                }
                entries = yield (0, FileCollector_1.collectEntriesFromDirectory)(sourceDir, statConcurrency);
                if (options.destPath) {
                    const prefix = options.destPath.replace(/\\/g, '/').replace(/\/+$/, '');
                    if (prefix.length > 0) {
                        entries = entries.map((e) => (Object.assign(Object.assign({}, e), { relativePath: prefix + '/' + e.relativePath.replace(/\\/g, '/').replace(/^\/+/, '') })));
                    }
                }
            }
            if (options.namePrependSlash) {
                entries = entries.map((e) => {
                    const rp = e.relativePath.startsWith('/') ? e.relativePath : '/' + e.relativePath;
                    return Object.assign(Object.assign({}, e), { relativePath: rp });
                });
            }
            for (const e of entries.filter((x) => x.isDirectory)) {
                zipper.addDirectoryEntry(e.relativePath, e.stat.mtime);
            }
            for (const e of entries.filter((x) => !x.isDirectory)) {
                yield zipper.addFileFromFs(e.fsPath, e.relativePath, e.stat.mtime);
            }
            if (!customWS && hasTargetPath) {
                const parentDir = path.dirname(path.resolve(targetFilePath));
                yield fs.promises.stat(parentDir);
            }
            const outStream = customWS !== null && customWS !== void 0 ? customWS : fs.createWriteStream(targetFilePath);
            yield zipper.writeToStream(outStream);
        });
    }
    static tar(source_1, targetFilePath_1) {
        return tslib_1.__awaiter(this, arguments, void 0, function* (source, targetFilePath, options = {}) {
            var _a;
            const customWS = options.customWriteStream;
            const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);
            if (!hasTargetPath && !customWS) {
                throw new Error('You must either provide a target file path or a custom write stream to write to.');
            }
            const statConcurrency = (_a = options.statConcurrency) !== null && _a !== void 0 ? _a : 4;
            const cwd = process.cwd();
            const isGlob = (0, utils_1.looksLikeGlob)(source);
            let entries = [];
            if (isGlob) {
                entries = yield (0, FileCollector_1.collectGlobEntries)(source, cwd, statConcurrency);
                if (entries.length === 0) {
                    throw new Error('No glob match found');
                }
            }
            else {
                const sourceDir = path.resolve(source);
                const st = yield fs.promises.stat(sourceDir);
                if (!st.isDirectory()) {
                    throw new Error('Source must be a directory when no glob pattern is used.');
                }
                if (hasTargetPath) {
                    const targetAbs = path.resolve(targetFilePath);
                    const targetDir = path.dirname(targetAbs);
                    const normalizedSourceDir = path.resolve(sourceDir);
                    if (targetDir === normalizedSourceDir || targetDir.startsWith(normalizedSourceDir + path.sep)) {
                        throw new Error('Source and target folder must be different.');
                    }
                }
                entries = yield (0, FileCollector_1.collectEntriesFromDirectory)(sourceDir, statConcurrency);
            }
            let gzipEnabled = options.gzip;
            if (options.compression === types_1.COMPRESSION_LEVEL.uncompressed) {
                gzipEnabled = false;
            }
            else if (gzipEnabled === undefined) {
                gzipEnabled = true;
            }
            const gzipOptions = Object.assign({}, (options.gzipOptions || {}));
            if (gzipEnabled && options.compression !== undefined) {
                switch (options.compression) {
                    case types_1.COMPRESSION_LEVEL.medium:
                        if (gzipOptions.level === undefined) {
                            gzipOptions.level = zlib.constants.Z_DEFAULT_COMPRESSION;
                        }
                        break;
                    case types_1.COMPRESSION_LEVEL.high:
                        if (gzipOptions.level === undefined) {
                            gzipOptions.level = zlib.constants.Z_BEST_COMPRESSION;
                        }
                        break;
                    default:
                        break;
                }
            }
            if (!customWS && hasTargetPath) {
                const parentDir = path.dirname(path.resolve(targetFilePath));
                yield fs.promises.stat(parentDir);
            }
            const finalOut = customWS !== null && customWS !== void 0 ? customWS : fs.createWriteStream(targetFilePath);
            let tarDestination;
            if (gzipEnabled) {
                const gzipStream = zlib.createGzip(gzipOptions);
                gzipStream.pipe(finalOut);
                tarDestination = gzipStream;
            }
            else {
                tarDestination = finalOut;
            }
            const tarWriter = new NativeTar_1.NativeTar(tarDestination);
            for (const e of entries.filter((x) => x.isDirectory)) {
                yield tarWriter.addDirectory(e);
            }
            for (const e of entries.filter((x) => !x.isDirectory)) {
                yield tarWriter.addFile(e);
            }
            yield tarWriter.finalize();
            yield new Promise((resolve, reject) => {
                var _a, _b;
                const finishTargetRaw = gzipEnabled ? finalOut : tarDestination;
                const finishTarget = finishTargetRaw;
                const onError = (err) => {
                    cleanup();
                    reject(err);
                };
                const onFinish = () => {
                    cleanup();
                    resolve();
                };
                const cleanup = () => {
                    finishTarget.removeListener('error', onError);
                    finishTarget.removeListener('finish', onFinish);
                };
                finishTarget.once('error', onError);
                finishTarget.once('finish', onFinish);
                (_b = (_a = tarDestination).end) === null || _b === void 0 ? void 0 : _b.call(_a);
            });
        });
    }
}
exports.ZipAFolder = ZipAFolder;
function zip(source, targetFilePath, options) {
    return ZipAFolder.zip(source, targetFilePath, options !== null && options !== void 0 ? options : {});
}
function tar(source, targetFilePath, options) {
    return ZipAFolder.tar(source, targetFilePath, options !== null && options !== void 0 ? options : {});
}
//# sourceMappingURL=ZipAFolder.js.map