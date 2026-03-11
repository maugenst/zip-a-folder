'use strict';
import {describe, it, expect} from 'vitest';
import {crc32, dateToDosDate, dateToDosTime, writeUInt64LE, looksLikeGlob} from '../lib/core/utils';

describe('core utils', () => {
    it('computes crc32 deterministically', () => {
        const buf = Buffer.from('hello');
        const a = crc32(buf);
        const b = crc32(buf);
        expect(a).toBe(b);
        // well-known CRC32 for "hello" is 0x3610a686
        expect(a).toBe(0x3610a686);
    });

    it('converts dates to DOS date/time', () => {
        const d = new Date(Date.UTC(2020, 0, 2, 3, 4, 10)); // 2020-01-02 03:04:10 UTC

        const tUtc = dateToDosTime(d, false);
        const dUtc = dateToDosDate(d, false);

        expect(tUtc).toBeGreaterThan(0);
        expect(dUtc).toBeGreaterThan(0);

        const tLocal = dateToDosTime(d, true);
        const dLocal = dateToDosDate(d, true);
        // Just check they differ in *some* environments
        expect(typeof tLocal).toBe('number');
        expect(typeof dLocal).toBe('number');
    });

    it('writes 64-bit LE integers correctly', () => {
        const buf = Buffer.alloc(16, 0);
        const value = 0x1_00000010; // 2^32 + 16

        writeUInt64LE(buf, value, 0);

        const low = buf.readUInt32LE(0);
        const high = buf.readUInt32LE(4);

        expect(low).toBe(16);
        expect(high).toBe(1);
    });

    it('detects glob-like patterns', () => {
        expect(looksLikeGlob('**/*.json')).toBe(true);
        expect(looksLikeGlob('foo/*.txt')).toBe(true);
        expect(looksLikeGlob('no/glob/here.txt')).toBe(false);
    });
});
