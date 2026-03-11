// src/core/types.ts
import * as fs from 'fs';
import * as zlib from 'zlib';

/**
 * Compression levels used as convenience presets for zlib/gzip/brotli.
 */
export type COMPRESSION_LEVELS = 'uncompressed' | 'medium' | 'high';

/**
 * Compression type for TAR archives.
 */
export type TAR_COMPRESSION_TYPE = 'none' | 'gzip' | 'brotli';

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

    /**
     * Glob patterns for files and directories to exclude from the archive.
     * Patterns are matched against relative paths inside the source directory.
     * Supports the same syntax as tinyglobby (picomatch-style globs).
     *
     * Example: exclude dot-files, dot-directories, and node_modules:
     * ```ts
     * exclude: ['**\/.*', '**\/.*\/**', 'node_modules\/**']
     * ```
     * Only applied for directory sources (not globs – for globs use negative patterns instead).
     */
    exclude?: string[];
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
    compression?: COMPRESSION_LEVELS;
};

/**
 * Options for creating TAR (and optionally compressed) archives.
 * Supports gzip and brotli compression natively via Node.js zlib module.
 */
export type TarArchiveOptions = CoreOptions & {
    /**
     * Compress the tar archive using gzip.
     * @deprecated Use `compressionType: 'gzip'` instead. This option is kept for backward compatibility.
     */
    gzip?: boolean;
    /** Passed to zlib to control gzip compression. */
    gzipOptions?: zlib.ZlibOptions;

    /**
     * Compression type for the tar archive.
     * - 'none': No compression (plain .tar file)
     * - 'gzip': Gzip compression (.tar.gz or .tgz file)
     * - 'brotli': Brotli compression (.tar.br file)
     * 
     * If not specified and `gzip` is not set, defaults to 'gzip'.
     * If `compression` is set to 'uncompressed', this is ignored and no compression is applied.
     */
    compressionType?: TAR_COMPRESSION_TYPE;

    /**
     * Brotli compression options passed to zlib.createBrotliCompress().
     * Only used when compressionType is 'brotli'.
     * 
     * @example
     * ```ts
     * brotliOptions: {
     *   params: {
     *     [zlib.constants.BROTLI_PARAM_QUALITY]: 11, // 0-11, higher = better compression
     *     [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
     *   }
     * }
     * ```
     */
    brotliOptions?: zlib.BrotliOptions;

    /** Custom writable stream; if provided, targetFilePath may be empty/undefined. */
    customWriteStream?: fs.WriteStream;

    /**
     * Convenience compression level, mapped onto gzip/brotli level.
     * - 'uncompressed': No compression (overrides compressionType)
     * - 'medium': Default compression level
     * - 'high': Best compression level
     */
    compression?: COMPRESSION_LEVELS;
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

/**
 * Options for creating 7z archives.
 * Uses LZMA compression via the lzma-js library.
 */
export type SevenZipArchiveOptions = CoreOptions & {
    /**
     * LZMA compression level (1-9).
     * - 1: Fastest compression, larger file
     * - 5: Balanced (default)
     * - 9: Best compression, slower
     */
    compressionLevel?: number;

    /** Custom writable stream; if provided, targetFilePath may be empty/undefined. */
    customWriteStream?: fs.WriteStream;

    /**
     * Convenience compression level preset.
     * - 'uncompressed': Not applicable for 7z (minimum compression used)
     * - 'medium': LZMA level 5
     * - 'high': LZMA level 9
     */
    compression?: COMPRESSION_LEVELS;
};
