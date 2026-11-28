import * as crypto from 'crypto';
import {PassThrough} from 'stream';

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
    /* v8 ignore next */
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
        /* v8 ignore next 4 */
        const onError = (err: Error) => {
            stream.removeListener('error', onError);
            reject(err);
        };
        stream.once('error', onError);
        stream.write(data, (err?: Error | null) => {
            stream.removeListener('error', onError);
            /* v8 ignore next 3 */
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

/**
 * A pass-through stream that counts the bytes flowing through it. Interposed
 * between an archive writer and its final destination so the archive's output
 * size can be reported even when writing to a user-supplied stream (where
 * `fs.stat` on a target path is not available).
 */
export class ByteCountingStream extends PassThrough {
    public bytesCounted = 0;

    constructor() {
        super();
        this.on('data', (chunk: Buffer) => {
            this.bytesCounted += chunk.length;
        });
    }
}

/**
 * Tracks archiving progress as an integer percent of a known total number of
 * input bytes, invoking the callback only when the rounded percentage advances
 * (monotonic, never decreasing). Call `advance` after each unit of work and
 * `finish` once at the end to guarantee a final 100.
 */
export class ProgressTracker {
    private processed = 0;
    private lastPercent = -1;
    private readonly callback?: (percent: number) => void;
    private readonly total: number;

    constructor(totalBytes: number, callback?: (percent: number) => void) {
        this.callback = callback;
        this.total = totalBytes;
    }

    /** Record `bytes` more processed and emit the new percent if it advanced. */
    advance(bytes: number): void {
        if (!this.callback) {
            return;
        }
        this.processed += bytes;
        // With no bytes to process, hold until finish() emits 100.
        const percent = this.total > 0 ? Math.min(99, Math.floor((this.processed / this.total) * 100)) : 0;
        // Only report forward movement past 0; the terminal 100 comes from finish().
        if (percent > 0 && percent > this.lastPercent) {
            this.lastPercent = percent;
            this.callback(percent);
        }
    }

    /** Emit the terminal 100 exactly once. */
    finish(): void {
        if (this.callback && this.lastPercent < 100) {
            this.lastPercent = 100;
            this.callback(100);
        }
    }
}

// WinZip AES (AE-2) for ZIP: AES-256, 16-byte salt, PBKDF2-HMAC-SHA1 with 1000
// iterations, AES-256 in WinZip's little-endian CTR mode, HMAC-SHA1 auth code.
const ZIP_AES_SALT_LENGTH = 16; // AES-256 strength
const ZIP_AES_PBKDF2_ITERATIONS = 1000;
const ZIP_AES_KEY_LENGTH = 32; // AES-256
const ZIP_AES_AUTH_CODE_LENGTH = 10; // truncated HMAC-SHA1
const AES_BLOCK_LENGTH = 16;

/**
 * Encrypt a buffer with the WinZip AES-256 (AE-2) scheme used by ZIP.
 *
 * Returns the salt, the 2-byte password-verification value, the ciphertext, and
 * the 10-byte truncated HMAC-SHA1 authentication code. The archived entry data
 * is their concatenation: `salt ++ passwordVerify ++ ciphertext ++ authCode`.
 */
export function winZipAesEncrypt(
    password: string,
    data: Buffer
): {salt: Buffer; passwordVerify: Buffer; ciphertext: Buffer; authCode: Buffer} {
    const salt = crypto.randomBytes(ZIP_AES_SALT_LENGTH);

    // Derive encryption key, authentication key, and the 2-byte verifier.
    const derived = crypto.pbkdf2Sync(
        Buffer.from(password, 'utf8'),
        salt,
        ZIP_AES_PBKDF2_ITERATIONS,
        ZIP_AES_KEY_LENGTH + ZIP_AES_KEY_LENGTH + 2,
        'sha1'
    );
    const encKey = derived.subarray(0, ZIP_AES_KEY_LENGTH);
    const authKey = derived.subarray(ZIP_AES_KEY_LENGTH, ZIP_AES_KEY_LENGTH * 2);
    const passwordVerify = Buffer.from(derived.subarray(ZIP_AES_KEY_LENGTH * 2, ZIP_AES_KEY_LENGTH * 2 + 2));

    // WinZip CTR: a 16-byte little-endian counter starting at 1, one AES-ECB
    // block of keystream per plaintext block, XORed with the data.
    const ecb = crypto.createCipheriv('aes-256-ecb', encKey, null);
    ecb.setAutoPadding(false);
    const ciphertext = Buffer.alloc(data.length);
    const counter = Buffer.alloc(AES_BLOCK_LENGTH, 0);
    let produced = 0;
    let blockIndex = 0n;
    while (produced < data.length) {
        counter.fill(0);
        let value = blockIndex + 1n;
        for (let b = 0; b < AES_BLOCK_LENGTH && value > 0n; b++) {
            counter[b] = Number(value & 0xffn);
            value >>= 8n;
        }
        const keystream = ecb.update(counter);
        const n = Math.min(AES_BLOCK_LENGTH, data.length - produced);
        for (let i = 0; i < n; i++) {
            ciphertext[produced + i] = data[produced + i] ^ keystream[i];
        }
        produced += n;
        blockIndex++;
    }

    const authCode = crypto
        .createHmac('sha1', authKey)
        .update(ciphertext)
        .digest()
        .subarray(0, ZIP_AES_AUTH_CODE_LENGTH);

    return {salt, passwordVerify, ciphertext, authCode};
}

// Legacy PKWARE "ZipCrypto" (traditional encryption). Cryptographically broken;
// provided only for compatibility with legacy readers. The keystream is driven
// by three 32-bit keys seeded from fixed constants and updated with CRC-32 over
// the password then the plaintext, one byte at a time.
const ZIPCRYPTO_HEADER_LENGTH = 12;

class ZipCryptoKeys {
    private key0 = 0x12345678;
    private key1 = 0x23456789;
    private key2 = 0x34567890;

    constructor(password: string) {
        for (const byte of Buffer.from(password, 'utf8')) {
            this.update(byte);
        }
    }

    private update(byte: number): void {
        this.key0 = (CRC32_TABLE[(this.key0 ^ byte) & 0xff] ^ (this.key0 >>> 8)) >>> 0;
        this.key1 = (this.key1 + (this.key0 & 0xff)) >>> 0;
        this.key1 = (Math.imul(this.key1, 134775813) + 1) >>> 0;
        this.key2 = (CRC32_TABLE[(this.key2 ^ (this.key1 >>> 24)) & 0xff] ^ (this.key2 >>> 8)) >>> 0;
    }

    private streamByte(): number {
        const temp = (this.key2 | 2) >>> 0;
        return (Math.imul(temp, temp ^ 1) >>> 8) & 0xff;
    }

    encrypt(data: Buffer): Buffer {
        const out = Buffer.alloc(data.length);
        for (let i = 0; i < data.length; i++) {
            out[i] = data[i] ^ this.streamByte();
            this.update(data[i]);
        }
        return out;
    }
}

/**
 * Encrypt a buffer with legacy PKWARE ZipCrypto. The output is the 12-byte
 * encryption header (11 random bytes + a check byte, the high byte of the
 * entry's CRC-32) followed by the encrypted data, all under one keystream.
 *
 * NOTE: ZipCrypto is cryptographically broken (practical known-plaintext
 * attack). Use only for compatibility with legacy readers.
 */
export function zipCryptoEncrypt(password: string, data: Buffer, crc32Value: number): Buffer {
    const keys = new ZipCryptoKeys(password);
    const header = Buffer.concat([
        crypto.randomBytes(ZIPCRYPTO_HEADER_LENGTH - 1),
        Buffer.from([(crc32Value >>> 24) & 0xff])
    ]);
    return Buffer.concat([keys.encrypt(header), keys.encrypt(data)]);
}
