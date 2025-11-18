import { TarArchiveOptions, ZipArchiveOptions } from './core/types';
export { COMPRESSION_LEVEL } from './core/types';
export declare class ZipAFolder {
    static zip(source: string, targetFilePath?: string, options?: ZipArchiveOptions): Promise<void>;
    static tar(source: string, targetFilePath?: string, options?: TarArchiveOptions): Promise<void>;
}
export declare function zip(source: string, targetFilePath?: string, options?: ZipArchiveOptions): Promise<void>;
export declare function tar(source: string, targetFilePath?: string, options?: TarArchiveOptions): Promise<void>;
