'use strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {COMPRESSION_LEVEL, zip} from '../lib/ZipAFolder';

describe('Zip options coverage', () => {
    const srcDir = path.resolve(__dirname, 'data');
    let tmpDir: string;
    let outZip: string;
    let outZipStore: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-a-folder-zip-opts-'));
        outZip = path.join(tmpDir, 'test.options.zip');
        outZipStore = path.join(tmpDir, 'test.options.store.zip');
    });

    afterAll(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    it('creates zip with comment, forceZip64, namePrependSlash', async () => {
        await zip(srcDir, outZip, {
            comment: 'test-comment',
            forceZip64: true,
            namePrependSlash: true,
            compression: COMPRESSION_LEVEL.medium
        });

        expect(fs.existsSync(outZip)).toBe(true);
        const stat = fs.statSync(outZip);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('creates uncompressed (STORE) zip explicitly', async () => {
        await zip(srcDir, outZipStore, {
            store: true,
            compression: COMPRESSION_LEVEL.uncompressed
        });

        expect(fs.existsSync(outZipStore)).toBe(true);
        const sizeStore = fs.statSync(outZipStore).size;

        // Just sanity check: previous compressed zip should not be *smaller* if store is used
        const sizeCompressed = fs.statSync(outZip).size;
        expect(sizeStore).toBeGreaterThanOrEqual(sizeCompressed || 0);
    });

    it('stores file times as local time by default', async () => {
        const tz = process.env.TZ;
        process.env.TZ = 'Asia/Kolkata';
        try {
            const dir = path.join(tmpDir, 'time-src');
            fs.mkdirSync(dir);
            const file = path.join(dir, 'f.txt');
            fs.writeFileSync(file, 'hi');
            const mtime = new Date(2024, 0, 15, 17, 30, 0);
            fs.utimesSync(file, mtime, mtime);

            const out = path.join(tmpDir, 'time.zip');
            await zip(dir, out);

            // DOS time in the first local file header: hours << 11 | minutes << 5 | seconds / 2
            const dosTime = fs.readFileSync(out).readUInt16LE(10);
            expect([dosTime >> 11, (dosTime >> 5) & 0x3f]).toEqual([17, 30]);
        } finally {
            if (tz === undefined) {
                delete process.env.TZ;
            } else {
                process.env.TZ = tz;
            }
        }
    });
});
