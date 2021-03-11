export declare class ZipAFolder {
    static zip(srcFolder: string, zipFilePath: string): Promise<void | Error>;
    static zipFolder(srcFolder: string, zipFilePath: string, callback: (error?: Error) => void): void;
}
