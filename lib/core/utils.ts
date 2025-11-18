/**
 * Precomputed CRC32 table for efficient checksum calculation.
 */
const CRC32_TABLE: Uint32Array = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            if (c & 1) {
                c = 0xedb88320 ^ (c >>> 1);
            } else {
                c = c >>> 1;
            }
        }
        table[i] = c >>> 0;
    }
    return table;
})();

/**
 * Compute CRC32 checksum for a buffer.
 */
export function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        const byte = buf[i];
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Convert a Date to DOS time (HH:MM:SS/2).
 * @param date      Date to convert.
 * @param useLocal  When true use local time, otherwise UTC.
 */
export function dateToDosTime(date: Date, useLocal: boolean): number {
    const secs = Math.floor((useLocal ? date.getSeconds() : date.getUTCSeconds()) / 2);
    const mins = useLocal ? date.getMinutes() : date.getUTCMinutes();
    const hrs = useLocal ? date.getHours() : date.getUTCHours();
    return (hrs << 11) | (mins << 5) | secs;
}

/**
 * Convert a Date to DOS date.
 * @param date      Date to convert.
 * @param useLocal  When true use local time, otherwise UTC.
 */
export function dateToDosDate(date: Date, useLocal: boolean): number {
    const year = useLocal ? date.getFullYear() : date.getUTCFullYear();
    const month = (useLocal ? date.getMonth() : date.getUTCMonth()) + 1;
    const day = useLocal ? date.getDate() : date.getUTCDate();
    /* istanbul ignore next */
    const dosYear = year < 1980 ? 0 : year - 1980;
    return (dosYear << 9) | (month << 5) | day;
}

/**
 * Write an ASCII string into a buffer with a fixed maximum length.
 */
export function writeString(buf: Buffer, str: string, offset: number, length: number): void {
    const bytes = Buffer.from(str, 'utf8');
    bytes.copy(buf, offset, 0, Math.min(bytes.length, length));
}

/**
 * Write an octal number into a buffer as ASCII text.
 */
export function writeOctal(buf: Buffer, value: number, offset: number, length: number): void {
    const oct = value.toString(8);
    const padded = oct.padStart(length - 1, '0');
    writeString(buf, padded, offset, length - 1);
    buf[offset + length - 1] = 0; // null terminator
}

/**
 * Write a 64-bit unsigned integer (up to 2^53-1) to a buffer in little-endian order.
 */
export function writeUInt64LE(buf: Buffer, value: number, offset: number): void {
    const low = value >>> 0;
    const high = Math.floor(value / 0x100000000) >>> 0;
    buf.writeUInt32LE(low, offset);
    buf.writeUInt32LE(high, offset + 4);
}

/**
 * Helper to write data to a Node writable stream and await completion.
 */
export function writeToStream(stream: NodeJS.WritableStream, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        /* istanbul ignore next */
        const onError = (err: Error) => {
            stream.removeListener('error', onError);
            reject(err);
        };
        stream.once('error', onError);
        stream.write(data, (err?: Error | null) => {
            stream.removeListener('error', onError);
            /* istanbul ignore next */
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Determine if a string "looks like" it contains glob characters.
 */
export function looksLikeGlob(source: string): boolean {
    return /[*?[\]{},]/.test(source);
}
