import { WriteStream } from 'fs';
export declare enum COMPRESSION_LEVEL {
    uncompressed = 0,
    medium = 5,
    high = 9
}
export type ZipAFolderOptions = {
    compression?: COMPRESSION_LEVEL;
    customWriteStream?: WriteStream;
    destPath?: string;
};
export declare class ZipAFolder {
    static tar(src: string, tarFilePath: string | undefined, zipAFolderOptions?: ZipAFolderOptions): Promise<void | Error>;
    static zip(src: string, zipFilePath: string | undefined, zipAFolderOptions?: ZipAFolderOptions): Promise<void | Error>;
    private static compress;
}
export declare const zip: typeof ZipAFolder.zip;
export declare const tar: typeof ZipAFolder.tar;
