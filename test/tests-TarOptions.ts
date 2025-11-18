'use strict';
import 'jest-extended';
import * as fs from 'fs';
import * as path from 'path';
import {COMPRESSION_LEVEL, tar} from '../lib/ZipAFolder';

describe('Tar options coverage', () => {
    const srcDir = path.resolve(__dirname, 'data');
    const outGz = path.resolve(__dirname, 'test.options.tgz');
    const outPlain = path.resolve(__dirname, 'test.options.plain.tar');

    afterAll(() => {
        if (fs.existsSync(outGz)) {
            fs.unlinkSync(outGz);
        }
        if (fs.existsSync(outPlain)) {
            fs.unlinkSync(outPlain);
        }
    });

    it('creates gzipped tar with custom gzipOptions', async () => {
        await tar(srcDir, outGz, {
            gzip: true,
            compression: COMPRESSION_LEVEL.high,
            gzipOptions: {chunkSize: 64 * 1024}
        });

        expect(fs.existsSync(outGz)).toBeTrue();
        const size = fs.statSync(outGz).size;
        expect(size).toBeGreaterThan(0);
    });

    it('creates plain tar when gzip is explicitly false', async () => {
        await tar(srcDir, outPlain, {
            gzip: false,
            compression: COMPRESSION_LEVEL.medium
        });

        expect(fs.existsSync(outPlain)).toBeTrue();
        const size = fs.statSync(outPlain).size;
        expect(size).toBeGreaterThan(0);
    });
});
