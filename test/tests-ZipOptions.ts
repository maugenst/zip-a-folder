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
});
