export declare enum COMPRESSION_LEVEL {
    uncompressed = 0,
    medium = 5,
    high = 9
}
export declare class ZipAFolder {
    static tar(srcFolder: string, zipFilePath: string, compression?: COMPRESSION_LEVEL): Promise<void | Error>;
    static zip(srcFolder: string, zipFilePath: string, compression?: COMPRESSION_LEVEL): Promise<void | Error>;
    private static compress;
}
export declare const zip: typeof ZipAFolder.zip;
export declare const tar: typeof ZipAFolder.tar;
