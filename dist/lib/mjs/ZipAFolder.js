import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { COMPRESSION_LEVEL } from './core/types';
import { collectEntriesFromDirectory, collectGlobEntries } from './core/FileCollector';
import { looksLikeGlob } from './core/utils';
import { NativeZip } from './zip/NativeZip';
import { NativeTar } from './tar/NativeTar';
export { COMPRESSION_LEVEL } from './core/types';
export class ZipAFolder {
    static async zip(source, targetFilePath, options = {}) {
        const customWS = options.customWriteStream;
        const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);
        if (!hasTargetPath && !customWS) {
            throw new Error('You must either provide a target file path or a custom write stream to write to.');
        }
        const statConcurrency = options.statConcurrency ?? 4;
        const zipStore = options.store === true || options.compression === COMPRESSION_LEVEL.uncompressed;
        const zlibOptions = {
            ...(options.zlib || {})
        };
        if (!zipStore && options.compression !== undefined) {
            switch (options.compression) {
                case COMPRESSION_LEVEL.medium:
                    if (zlibOptions.level === undefined) {
                        zlibOptions.level = zlib.constants.Z_DEFAULT_COMPRESSION;
                    }
                    break;
                case COMPRESSION_LEVEL.high:
                    if (zlibOptions.level === undefined) {
                        zlibOptions.level = zlib.constants.Z_BEST_COMPRESSION;
                    }
                    break;
                default:
                    break;
            }
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
            entries = await collectGlobEntries(source, cwd, statConcurrency);
            if (entries.length === 0) {
                throw new Error('No glob match found');
            }
        }
        else {
            const sourceDir = path.resolve(source);
            const st = await fs.promises.stat(sourceDir);
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
            entries = await collectEntriesFromDirectory(sourceDir, statConcurrency);
            if (options.destPath) {
                const prefix = options.destPath.replace(/\\/g, '/').replace(/\/+$/, '');
                if (prefix.length > 0) {
                    entries = entries.map((e) => ({
                        ...e,
                        relativePath: prefix + '/' + e.relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
                    }));
                }
            }
        }
        if (options.namePrependSlash) {
            entries = entries.map((e) => {
                const rp = e.relativePath.startsWith('/') ? e.relativePath : '/' + e.relativePath;
                return { ...e, relativePath: rp };
            });
        }
        for (const e of entries.filter((x) => x.isDirectory)) {
            zipper.addDirectoryEntry(e.relativePath, e.stat.mtime);
        }
        for (const e of entries.filter((x) => !x.isDirectory)) {
            await zipper.addFileFromFs(e.fsPath, e.relativePath, e.stat.mtime);
        }
        if (!customWS && hasTargetPath) {
            const parentDir = path.dirname(path.resolve(targetFilePath));
            await fs.promises.stat(parentDir);
        }
        const outStream = customWS ?? fs.createWriteStream(targetFilePath);
        await zipper.writeToStream(outStream);
    }
    static async tar(source, targetFilePath, options = {}) {
        const customWS = options.customWriteStream;
        const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);
        if (!hasTargetPath && !customWS) {
            throw new Error('You must either provide a target file path or a custom write stream to write to.');
        }
        const statConcurrency = options.statConcurrency ?? 4;
        const cwd = process.cwd();
        const isGlob = looksLikeGlob(source);
        let entries = [];
        if (isGlob) {
            entries = await collectGlobEntries(source, cwd, statConcurrency);
            if (entries.length === 0) {
                throw new Error('No glob match found');
            }
        }
        else {
            const sourceDir = path.resolve(source);
            const st = await fs.promises.stat(sourceDir);
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
            entries = await collectEntriesFromDirectory(sourceDir, statConcurrency);
        }
        let gzipEnabled = options.gzip;
        if (options.compression === COMPRESSION_LEVEL.uncompressed) {
            gzipEnabled = false;
        }
        else if (gzipEnabled === undefined) {
            gzipEnabled = true;
        }
        const gzipOptions = { ...(options.gzipOptions || {}) };
        if (gzipEnabled && options.compression !== undefined) {
            switch (options.compression) {
                case COMPRESSION_LEVEL.medium:
                    if (gzipOptions.level === undefined) {
                        gzipOptions.level = zlib.constants.Z_DEFAULT_COMPRESSION;
                    }
                    break;
                case COMPRESSION_LEVEL.high:
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
            await fs.promises.stat(parentDir);
        }
        const finalOut = customWS ?? fs.createWriteStream(targetFilePath);
        let tarDestination;
        if (gzipEnabled) {
            const gzipStream = zlib.createGzip(gzipOptions);
            gzipStream.pipe(finalOut);
            tarDestination = gzipStream;
        }
        else {
            tarDestination = finalOut;
        }
        const tarWriter = new NativeTar(tarDestination);
        for (const e of entries.filter((x) => x.isDirectory)) {
            await tarWriter.addDirectory(e);
        }
        for (const e of entries.filter((x) => !x.isDirectory)) {
            await tarWriter.addFile(e);
        }
        await tarWriter.finalize();
        await new Promise((resolve, reject) => {
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
            tarDestination.end?.();
        });
    }
}
export function zip(source, targetFilePath, options) {
    return ZipAFolder.zip(source, targetFilePath, options ?? {});
}
export function tar(source, targetFilePath, options) {
    return ZipAFolder.tar(source, targetFilePath, options ?? {});
}
//# sourceMappingURL=ZipAFolder.js.map