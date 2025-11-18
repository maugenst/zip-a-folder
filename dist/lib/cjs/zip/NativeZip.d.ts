import * as zlib from 'zlib';
export interface NativeZipOptions {
    comment?: string;
    forceLocalTime?: boolean;
    forceZip64?: boolean;
    namePrependSlash?: boolean;
    store?: boolean;
    zlib?: zlib.ZlibOptions;
}
export declare class NativeZip {
    private entries;
    private comment?;
    private useLocalTime;
    private forceZip64;
    private store;
    private zlibOptions?;
    constructor(options?: NativeZipOptions);
    addDirectoryEntry(archivePath: string, date: Date): void;
    addFileFromFs(filePath: string, archivePath: string, date: Date): Promise<void>;
    writeToStream(stream: NodeJS.WritableStream): Promise<void>;
}
