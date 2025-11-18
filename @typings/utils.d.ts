export declare function crc32(buf: Buffer): number;
export declare function dateToDosTime(date: Date, useLocal: boolean): number;
export declare function dateToDosDate(date: Date, useLocal: boolean): number;
export declare function writeString(buf: Buffer, str: string, offset: number, length: number): void;
export declare function writeOctal(buf: Buffer, value: number, offset: number, length: number): void;
export declare function writeUInt64LE(buf: Buffer, value: number, offset: number): void;
export declare function writeToStream(stream: NodeJS.WritableStream, data: Buffer): Promise<void>;
export declare function looksLikeGlob(source: string): boolean;
