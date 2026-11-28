// src/ZipAFolder.ts
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import {Native7z} from './7z/Native7z';
import {collectEntriesFromDirectory, collectGlobEntries} from './core/FileCollector';
import {
    ArchiveResult,
    COMPRESSION_LEVELS,
    FileEntry,
    SevenZipArchiveOptions,
    TAR_COMPRESSION_TYPE,
    TarArchiveOptions,
    ZipArchiveOptions
} from './core/types';
import {ByteCountingStream, looksLikeGlob, ProgressTracker} from './core/utils';
import {NativeTar} from './tar/NativeTar';
import {NativeZip} from './zip/NativeZip';

export type {
    ArchiveResult,
    SevenZipArchiveOptions,
    TAR_COMPRESSION_TYPE,
    TarArchiveOptions,
    ZipArchiveOptions
} from './core/types';

export const COMPRESSION_LEVEL = {
    uncompressed: 'uncompressed',
    medium: 'medium',
    high: 'high'
} as const satisfies Record<COMPRESSION_LEVELS, string>;

/**
 * High-level facade class that provides ZIP/TAR creation helpers.
 *
 * Public API expected by tests:
 *  - ZipAFolder.zip(...)
 *  - ZipAFolder.tar(...)
 *  - zip(...)
 *  - tar(...)
 */
export class ZipAFolder {
    /**
     * Create a ZIP archive from a directory or glob.
     *
     * @param source         Directory path OR glob pattern.
     * @param targetFilePath Path to target zip file. May be empty/undefined if customWriteStream is provided.
     * @param options        ZIP options.
     */
    public static async zip(
        source: string,
        targetFilePath?: string,
        options: ZipArchiveOptions = {}
    ): Promise<ArchiveResult> {
        const customWS = options.customWriteStream;
        const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);

        if (!hasTargetPath && !customWS) {
            throw new Error('You must either provide a target file path or a custom write stream to write to.');
        }

        const statConcurrency = options.statConcurrency ?? 4;

        // Resolve compression/store/zlib mapping.
        const zipStore = options.store === true || options.compression === 'uncompressed';

        const zlibOptions: zlib.ZlibOptions | undefined = {
            ...(options.zlib || {})
        };

        if (!zipStore && options.compression !== undefined) {
            switch (options.compression) {
                case 'medium':
                    if (zlibOptions.level === undefined) {
                        zlibOptions.level = zlib.constants.Z_DEFAULT_COMPRESSION;
                    }
                    break;
                case 'high':
                    if (zlibOptions.level === undefined) {
                        zlibOptions.level = zlib.constants.Z_BEST_COMPRESSION;
                    }
                    break;
                /* v8 ignore next 3 */
                default:
                    // defensive: invalid compression value
                    break;
            }
        }

        const zipper = new NativeZip({
            comment: options.comment,
            forceLocalTime: options.forceLocalTime,
            forceZip64: options.forceZip64,
            namePrependSlash: options.namePrependSlash,
            store: zipStore,
            zlib: zlibOptions,
            password: options.password,
            encryptionMethod: options.encryptionMethod
        });

        const cwd = process.cwd();
        const isGlob = looksLikeGlob(source);
        let entries: FileEntry[] = [];

        if (isGlob) {
            // Glob mode: collect files relative to cwd, no directories.
            entries = await collectGlobEntries(source, cwd, statConcurrency, options.exclude);
            if (entries.length === 0) {
                throw new Error('No glob match found');
            }
        } else {
            // Directory mode.
            const sourceDir = path.resolve(source);
            const st = await fs.promises.stat(sourceDir); // may throw ENOENT
            if (!st.isDirectory()) {
                throw new Error('Source must be a directory when no glob pattern is used.');
            }

            if (hasTargetPath) {
                const targetAbs = path.resolve(targetFilePath as string);
                const targetDir = path.dirname(targetAbs);
                const normalizedSourceDir = path.resolve(sourceDir);

                // Disallow target in the same folder or any subfolder of source
                if (targetDir === normalizedSourceDir || targetDir.startsWith(normalizedSourceDir + path.sep)) {
                    throw new Error('Source and target folder must be different.');
                }
            }

            entries = await collectEntriesFromDirectory(sourceDir, statConcurrency, options.exclude);

            // Mirror original zip-a-folder behavior: archive paths are
            // contents of source directory (no root folder), but we optionally
            // prefix with destPath if provided.
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

        // Apply namePrependSlash: add leading "/" for all entry paths.
        if (options.namePrependSlash) {
            entries = entries.map((e) => {
                /* v8 ignore next */
                const rp = e.relativePath.startsWith('/') ? e.relativePath : '/' + e.relativePath;
                return {...e, relativePath: rp};
            });
        }

        // Directories first (for directory-based use).
        for (const e of entries.filter((x) => x.isDirectory)) {
            zipper.addDirectoryEntry(e.relativePath, e.stat.mtime, e.stat.mode);
        }

        // Files.
        const fileEntries = entries.filter((x) => !x.isDirectory);
        const progress = new ProgressTracker(
            fileEntries.reduce((sum, e) => sum + e.stat.size, 0),
            options.onProgress
        );
        for (const e of fileEntries) {
            await zipper.addFileFromFs(e.fsPath, e.relativePath, e.stat.mtime, e.stat.mode);
            progress.advance(e.stat.size);
        }

        if (!customWS && hasTargetPath) {
            // Fail early if parent directory does not exist
            const parentDir = path.dirname(path.resolve(targetFilePath as string));
            await fs.promises.stat(parentDir); // will throw ENOENT if missing
        }

        const destination: NodeJS.WritableStream = customWS ?? fs.createWriteStream(targetFilePath as string);
        const counter = new ByteCountingStream();
        counter.pipe(destination);

        await zipper.writeToStream(counter);
        await ZipAFolder.awaitDrain(destination);
        progress.finish();

        return {count: fileEntries.length, size: counter.bytesCounted};
    }

    /**
     * Create a TAR (optionally gzipped) archive from a directory or glob.
     *
     * @param source         Directory path OR glob pattern.
     * @param targetFilePath Path to target tar/tgz file. May be empty/undefined if customWriteStream is provided.
     * @param options        TAR/gzip options.
     */
    public static async tar(
        source: string,
        targetFilePath?: string,
        options: TarArchiveOptions = {}
    ): Promise<ArchiveResult> {
        const customWS = options.customWriteStream;
        const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);

        if (!hasTargetPath && !customWS) {
            throw new Error('You must either provide a target file path or a custom write stream to write to.');
        }

        const statConcurrency = options.statConcurrency ?? 4;
        const cwd = process.cwd();
        const isGlob = looksLikeGlob(source);
        let entries: FileEntry[] = [];

        if (isGlob) {
            entries = await collectGlobEntries(source, cwd, statConcurrency, options.exclude);
            if (entries.length === 0) {
                throw new Error('No glob match found');
            }
        } else {
            const sourceDir = path.resolve(source);
            const st = await fs.promises.stat(sourceDir); // may throw ENOENT
            if (!st.isDirectory()) {
                throw new Error('Source must be a directory when no glob pattern is used.');
            }

            if (hasTargetPath) {
                const targetAbs = path.resolve(targetFilePath as string);
                const targetDir = path.dirname(targetAbs);
                const normalizedSourceDir = path.resolve(sourceDir);

                // Disallow target in the same folder or any subfolder of source
                if (targetDir === normalizedSourceDir || targetDir.startsWith(normalizedSourceDir + path.sep)) {
                    throw new Error('Source and target folder must be different.');
                }
            }

            entries = await collectEntriesFromDirectory(sourceDir, statConcurrency, options.exclude);
        }

        // Determine compression type from options.
        // Priority: compression='uncompressed' > compressionType > gzip (legacy) > default gzip
        let compressionType: TAR_COMPRESSION_TYPE = 'gzip'; // default

        if (options.compression === 'uncompressed') {
            compressionType = 'none';
        } else if (options.compressionType !== undefined) {
            compressionType = options.compressionType;
        } else if (options.gzip !== undefined) {
            // Legacy backward compatibility: gzip option
            compressionType = options.gzip ? 'gzip' : 'none';
        }

        // Prepare gzip options if using gzip compression
        const gzipOptions: zlib.ZlibOptions = {...(options.gzipOptions || {})};

        if (compressionType === 'gzip' && options.compression !== undefined) {
            switch (options.compression) {
                case 'medium':
                    if (gzipOptions.level === undefined) {
                        gzipOptions.level = zlib.constants.Z_DEFAULT_COMPRESSION;
                    }
                    break;
                case 'high':
                    if (gzipOptions.level === undefined) {
                        gzipOptions.level = zlib.constants.Z_BEST_COMPRESSION;
                    }
                    break;
                /* v8 ignore next 2 */
                default:
                    break;
            }
        }

        // Prepare brotli options if using brotli compression
        const brotliOptions: zlib.BrotliOptions = {...(options.brotliOptions || {})};

        if (compressionType === 'brotli' && options.compression !== undefined) {
            // Initialize params object if not present
            if (!brotliOptions.params) {
                brotliOptions.params = {};
            }

            // Only set quality if not already specified
            if (brotliOptions.params[zlib.constants.BROTLI_PARAM_QUALITY] === undefined) {
                switch (options.compression) {
                    case 'medium':
                        // Default brotli quality is 11, use 6 for medium (faster)
                        brotliOptions.params[zlib.constants.BROTLI_PARAM_QUALITY] = 6;
                        break;
                    case 'high':
                        // Maximum brotli quality
                        brotliOptions.params[zlib.constants.BROTLI_PARAM_QUALITY] = zlib.constants.BROTLI_MAX_QUALITY;
                        break;
                    /* v8 ignore next 2 */
                    default:
                        break;
                }
            }
        }

        if (!customWS && hasTargetPath) {
            const parentDir = path.dirname(path.resolve(targetFilePath as string));
            await fs.promises.stat(parentDir); // may throw ENOENT
        }

        const finalOut: fs.WriteStream | NodeJS.WritableStream =
            customWS ?? fs.createWriteStream(targetFilePath as string);

        // Count the final archive bytes just before they reach the destination,
        // so the size is correct for plain, gzip and brotli output alike.
        const counter = new ByteCountingStream();
        counter.pipe(finalOut);

        let tarDestination: NodeJS.WritableStream;

        if (compressionType === 'gzip') {
            const gzipStream = zlib.createGzip(gzipOptions);
            gzipStream.pipe(counter);
            tarDestination = gzipStream;
        } else if (compressionType === 'brotli') {
            const brotliStream = zlib.createBrotliCompress(brotliOptions);
            brotliStream.pipe(counter);
            tarDestination = brotliStream;
        } else {
            tarDestination = counter;
        }

        const tarWriter = new NativeTar(tarDestination);

        // Directory entries (directory-source only; glob entries are files-only).
        for (const e of entries.filter((x) => x.isDirectory)) {
            await tarWriter.addDirectory(e);
        }
        // File entries.
        const fileEntries = entries.filter((x) => !x.isDirectory);
        const progress = new ProgressTracker(
            fileEntries.reduce((sum, e) => sum + e.stat.size, 0),
            options.onProgress
        );
        for (const e of fileEntries) {
            await tarWriter.addFile(e);
            progress.advance(e.stat.size);
        }

        await tarWriter.finalize();

        // Ensure we flush + close output. finalOut always finishes last because
        // the counter pipes into it.
        await new Promise<void>((resolve, reject) => {
            const finishTarget = finalOut as NodeJS.WritableStream;
            /* v8 ignore next 4 */
            const onError = (err: Error) => {
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

            // End the tarDestination (which flushes through gzip/brotli and the
            // counter into finalOut).
            (tarDestination as any).end?.();
        });
        progress.finish();

        return {count: fileEntries.length, size: counter.bytesCounted};
    }

    /**
     * Create a 7z archive from a directory or glob using LZMA compression.
     *
     * @param source         Directory path OR glob pattern.
     * @param targetFilePath Path to target .7z file. May be empty/undefined if customWriteStream is provided.
     * @param options        7z/LZMA options.
     */
    public static async sevenZip(
        source: string,
        targetFilePath?: string,
        options: SevenZipArchiveOptions = {}
    ): Promise<ArchiveResult> {
        const customWS = options.customWriteStream;
        const hasTargetPath = !!(targetFilePath && targetFilePath.length > 0);

        if (!hasTargetPath && !customWS) {
            throw new Error('You must either provide a target file path or a custom write stream to write to.');
        }

        const statConcurrency = options.statConcurrency ?? 4;
        const cwd = process.cwd();
        const isGlob = looksLikeGlob(source);
        let entries: FileEntry[] = [];

        if (isGlob) {
            entries = await collectGlobEntries(source, cwd, statConcurrency, options.exclude);
            if (entries.length === 0) {
                throw new Error('No glob match found');
            }
        } else {
            const sourceDir = path.resolve(source);
            const st = await fs.promises.stat(sourceDir); // may throw ENOENT
            if (!st.isDirectory()) {
                throw new Error('Source must be a directory when no glob pattern is used.');
            }

            if (hasTargetPath) {
                const targetAbs = path.resolve(targetFilePath as string);
                const targetDir = path.dirname(targetAbs);
                const normalizedSourceDir = path.resolve(sourceDir);

                // Disallow target in the same folder or any subfolder of source
                if (targetDir === normalizedSourceDir || targetDir.startsWith(normalizedSourceDir + path.sep)) {
                    throw new Error('Source and target folder must be different.');
                }
            }

            entries = await collectEntriesFromDirectory(sourceDir, statConcurrency, options.exclude);
        }

        // Determine compression level. An explicit numeric `compressionLevel`
        // (1-9) always wins — it is the more specific control. Only when it is
        // absent does the `compression` preset decide the level; with neither,
        // the default is 5.
        let compressionLevel: number;

        if (options.compressionLevel !== undefined) {
            compressionLevel = options.compressionLevel;
        } else {
            switch (options.compression) {
                case 'uncompressed':
                    compressionLevel = 1; // 7z always uses LZMA, use minimum compression
                    break;
                case 'high':
                    compressionLevel = 9;
                    break;
                default:
                    // 'medium' or no preset at all.
                    compressionLevel = 5;
                    break;
            }
        }

        if (!customWS && hasTargetPath) {
            const parentDir = path.dirname(path.resolve(targetFilePath as string));
            await fs.promises.stat(parentDir); // may throw ENOENT
        }

        const destination: NodeJS.WritableStream = customWS ?? fs.createWriteStream(targetFilePath as string);
        const counter = new ByteCountingStream();
        counter.pipe(destination);
        const sevenZWriter = new Native7z(compressionLevel, options.password);

        // Add file entries (7z doesn't need explicit directory entries). Progress
        // tracks the file-reading phase; the single LZMA step runs in writeToStream.
        const fileEntries = entries.filter((e) => !e.isDirectory);
        const progress = new ProgressTracker(
            fileEntries.reduce((sum, e) => sum + e.stat.size, 0),
            options.onProgress
        );
        for (const e of entries) {
            await sevenZWriter.addFile(e);
            if (!e.isDirectory) {
                progress.advance(e.stat.size);
            }
        }

        await sevenZWriter.writeToStream(counter);
        await ZipAFolder.awaitDrain(destination);
        progress.finish();

        return {count: sevenZWriter.fileCount, size: counter.bytesCounted};
    }

    /**
     * Resolve once a destination stream has fully flushed (finished or closed).
     * `fs.createWriteStream` emits 'finish' after the counter's end propagates
     * through the pipe; a user-supplied stream may only emit 'close'.
     */
    private static awaitDrain(stream: NodeJS.WritableStream): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            /* v8 ignore next 4 -- stream already drained before we attached listeners */
            if ((stream as any).writableFinished) {
                resolve();
                return;
            }
            const cleanup = () => {
                stream.removeListener('error', onError);
                stream.removeListener('finish', onDone);
                stream.removeListener('close', onDone);
            };
            const onDone = () => {
                cleanup();
                resolve();
            };
            /* v8 ignore next 4 */
            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };
            stream.once('finish', onDone);
            stream.once('close', onDone);
            stream.once('error', onError);
        });
    }
}

/**
 * Convenience function: zip(...) directly.
 */
export function zip(source: string, targetFilePath?: string, options?: ZipArchiveOptions): Promise<ArchiveResult> {
    return ZipAFolder.zip(source, targetFilePath, options ?? {});
}

/**
 * Convenience function: tar(...) directly.
 */
export function tar(source: string, targetFilePath?: string, options?: TarArchiveOptions): Promise<ArchiveResult> {
    return ZipAFolder.tar(source, targetFilePath, options ?? {});
}

/**
 * Convenience function: sevenZip(...) directly.
 * Creates a 7z archive using LZMA compression.
 */
export function sevenZip(
    source: string,
    targetFilePath?: string,
    options?: SevenZipArchiveOptions
): Promise<ArchiveResult> {
    return ZipAFolder.sevenZip(source, targetFilePath, options ?? {});
}
