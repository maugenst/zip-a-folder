'use strict';
import 'jest-extended';
import * as fs from 'fs';
import * as path from 'path';
import {COMPRESSION_LEVEL, zip} from '../lib/ZipAFolder';

describe('Zip options coverage', () => {
    const outZip = path.resolve(__dirname, 'test.options.zip');
    const outZipStore = path.resolve(__dirname, 'test.options.store.zip');
    const srcDir = path.resolve(__dirname, 'data'); // you already use this in other tests

    afterAll(() => {
        if (fs.existsSync(outZip)) {
            fs.unlinkSync(outZip);
        }
        if (fs.existsSync(outZipStore)) {
            fs.unlinkSync(outZipStore);
        }
    });

    it('creates zip with comment, forceZip64, namePrependSlash', async () => {
        await zip(srcDir, outZip, {
            comment: 'test-comment',
            forceZip64: true,
            namePrependSlash: true,
            compression: COMPRESSION_LEVEL.medium
        });

        expect(fs.existsSync(outZip)).toBeTrue();
        const stat = fs.statSync(outZip);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('creates uncompressed (STORE) zip explicitly', async () => {
        await zip(srcDir, outZipStore, {
            store: true,
            compression: COMPRESSION_LEVEL.uncompressed
        });

        expect(fs.existsSync(outZipStore)).toBeTrue();
        const sizeStore = fs.statSync(outZipStore).size;

        // Just sanity check: previous compressed zip should not be *smaller* if store is used
        const sizeCompressed = fs.statSync(outZip).size;
        expect(sizeStore).toBeGreaterThanOrEqual(sizeCompressed || 0);
    });
});
