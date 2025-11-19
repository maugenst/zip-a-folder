// src/core/types.ts
import * as fs from 'fs';

/**
 * Compression levels used as convenience presets for zlib/gzip.
 */
export enum COMPRESSION_LEVEL {
    uncompressed = 0,
    medium = 1,
    high = 2
}

/**
 * Basic core options shared by ZIP and TAR archives.
 */
export type CoreOptions = {
    /**
     * Sets the number of workers used to process the internal fs stat queue.
     * Higher values can speed up scanning of very large directory trees.
     * Default is 4.
     */
    statConcurrency?: number;
};

/**
 * Options for creating ZIP archives.
 */
export type ZipArchiveOptions = CoreOptions & {
    /** Sets the zip archive comment. */
    comment?: string;
    /** Forces the archive to contain local file times instead of UTC. */
    forceLocalTime?: boolean;
    /**
     * Forces the archive to contain ZIP64 headers.
     * NOTE: This implementation auto-enables ZIP64 when needed (sizes > 4GB, etc.).
     * This flag acts as a hint to always use ZIP64 structures where applicable.
     */
    forceZip64?: boolean;
    /** Prepends a forward slash to archive file paths. */
    namePrependSlash?: boolean;
    /** Sets the compression method to STORE (no compression). */
    store?: boolean;
    /**
     * Passed to zlib to control compression of individual files.
     * https://nodejs.org/api/zlib.html#zlib_class_options
     */
    zlib?: import('zlib').ZlibOptions;

    /** Custom writable stream; if provided, targetFilePath may be empty/undefined. */
    customWriteStream?: fs.WriteStream;

    /**
     * Destination path prefix **inside** the ZIP.
     * Example: "data/" => all entries start with "data/".
     * Only applied for directory sources (not globs).
     */
    destPath?: string;

    /**
     * Convenience compression level:
     *  - uncompressed => store/no compression
     *  - medium/high  => DEFLATE with suitable zlib level
     */
    compression?: COMPRESSION_LEVEL;
};

/**
 * Options for creating TAR (and optionally gzipped) archives.
 */
export type TarArchiveOptions = CoreOptions & {
    /** Compress the tar archive using gzip. */
    gzip?: boolean;
    /** Passed to zlib to control gzip compression. */
    gzipOptions?: import('zlib').ZlibOptions;

    /** Custom writable stream; if provided, targetFilePath may be empty/undefined. */
    customWriteStream?: fs.WriteStream;

    /** Convenience compression level, mapped onto gzip level. */
    compression?: COMPRESSION_LEVEL;
};

/**
 * Internal representation of a filesystem entry used by ZIP/TAR builders.
 */
export type FileEntry = {
    /** Absolute filesystem path. */
    fsPath: string;
    /** Path inside the archive (POSIX style, forward slashes). */
    relativePath: string;
    /** True if this entry is a directory. */
    isDirectory: boolean;
    /** Node.js fs Stats object for this entry. */
    stat: fs.Stats;
};
