// src/ZipAFolder.ts
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import {collectEntriesFromDirectory, collectGlobEntries} from './core/FileCollector';
import {COMPRESSION_LEVELS, FileEntry, TarArchiveOptions, ZipArchiveOptions} from './core/types';
import {looksLikeGlob} from './core/utils';
import {NativeTar} from './tar/NativeTar';
import {NativeZip} from './zip/NativeZip';

export type {TarArchiveOptions, ZipArchiveOptions} from './core/types';

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
    public static async zip(source: string, targetFilePath?: string, options: ZipArchiveOptions = {}): Promise<void> {
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
            zlib: zlibOptions
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
        for (const e of entries.filter((x) => !x.isDirectory)) {
            await zipper.addFileFromFs(e.fsPath, e.relativePath, e.stat.mtime, e.stat.mode);
        }

        if (!customWS && hasTargetPath) {
            // Fail early if parent directory does not exist
            const parentDir = path.dirname(path.resolve(targetFilePath as string));
            await fs.promises.stat(parentDir); // will throw ENOENT if missing
        }

        const outStream: NodeJS.WritableStream = customWS ?? fs.createWriteStream(targetFilePath as string);

        await zipper.writeToStream(outStream);
    }

    /**
     * Create a TAR (optionally gzipped) archive from a directory or glob.
     *
     * @param source         Directory path OR glob pattern.
     * @param targetFilePath Path to target tar/tgz file. May be empty/undefined if customWriteStream is provided.
     * @param options        TAR/gzip options.
     */
    public static async tar(source: string, targetFilePath?: string, options: TarArchiveOptions = {}): Promise<void> {
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

        // Determine gzip settings from options + compression level.
        let gzipEnabled = options.gzip;
        if (options.compression === 'uncompressed') {
            gzipEnabled = false;
        } else if (gzipEnabled === undefined) {
            // Default: gzip if not explicitly disabled and not explicitly uncompressed.
            gzipEnabled = true;
        }

        const gzipOptions: zlib.ZlibOptions = {...(options.gzipOptions || {})};

        if (gzipEnabled && options.compression !== undefined) {
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

        if (!customWS && hasTargetPath) {
            const parentDir = path.dirname(path.resolve(targetFilePath as string));
            await fs.promises.stat(parentDir); // may throw ENOENT
        }

        const finalOut: fs.WriteStream | NodeJS.WritableStream =
            customWS ?? fs.createWriteStream(targetFilePath as string);

        let tarDestination: NodeJS.WritableStream;

        if (gzipEnabled) {
            const gzipStream = zlib.createGzip(gzipOptions);
            gzipStream.pipe(finalOut);
            tarDestination = gzipStream;
        } else {
            tarDestination = finalOut;
        }

        const tarWriter = new NativeTar(tarDestination);

        // Directory entries (directory-source only; glob entries are files-only).
        for (const e of entries.filter((x) => x.isDirectory)) {
            await tarWriter.addDirectory(e);
        }
        // File entries.
        for (const e of entries.filter((x) => !x.isDirectory)) {
            await tarWriter.addFile(e);
        }

        await tarWriter.finalize();

        // Ensure we flush + close output.
        await new Promise<void>((resolve, reject) => {
            const finishTargetRaw = gzipEnabled ? finalOut : tarDestination;
            // Explicitly treat this as a NodeJS-style writable stream.
            const finishTarget = finishTargetRaw as NodeJS.WritableStream;
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

            // End the tarDestination (which will flush through gzip if enabled).
            (tarDestination as any).end?.();
        });
    }
}

/**
 * Convenience function: zip(...) directly.
 */
export function zip(source: string, targetFilePath?: string, options?: ZipArchiveOptions): Promise<void> {
    return ZipAFolder.zip(source, targetFilePath, options ?? {});
}

/**
 * Convenience function: tar(...) directly.
 */
export function tar(source: string, targetFilePath?: string, options?: TarArchiveOptions): Promise<void> {
    return ZipAFolder.tar(source, targetFilePath, options ?? {});
}
