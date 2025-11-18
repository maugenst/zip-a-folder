import * as fs from 'fs';
export declare enum COMPRESSION_LEVEL {
    uncompressed = 0,
    medium = 1,
    high = 2
}
export interface CoreOptions {
    statConcurrency?: number;
}
export interface ZipArchiveOptions extends CoreOptions {
    comment?: string;
    forceLocalTime?: boolean;
    forceZip64?: boolean;
    namePrependSlash?: boolean;
    store?: boolean;
    zlib?: import('zlib').ZlibOptions;
    customWriteStream?: fs.WriteStream;
    destPath?: string;
    compression?: COMPRESSION_LEVEL;
}
export interface TarArchiveOptions extends CoreOptions {
    gzip?: boolean;
    gzipOptions?: import('zlib').ZlibOptions;
    customWriteStream?: fs.WriteStream;
    compression?: COMPRESSION_LEVEL;
}
export interface FileEntry {
    fsPath: string;
    relativePath: string;
    isDirectory: boolean;
    stat: fs.Stats;
}
