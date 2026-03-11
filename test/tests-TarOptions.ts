'use strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {COMPRESSION_LEVEL, tar} from '../lib/ZipAFolder';

describe('Tar options coverage', () => {
    const srcDir = path.resolve(__dirname, 'data');
    let tmpDir: string;
    let outGz: string;
    let outPlain: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-a-folder-tar-opts-'));
        outGz = path.join(tmpDir, 'test.options.tgz');
        outPlain = path.join(tmpDir, 'test.options.plain.tar');
    });

    afterAll(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    it('creates gzipped tar with custom gzipOptions', async () => {
        await tar(srcDir, outGz, {
            gzip: true,
            compression: COMPRESSION_LEVEL.high,
            gzipOptions: {chunkSize: 64 * 1024}
        });

        expect(fs.existsSync(outGz)).toBe(true);
        const size = fs.statSync(outGz).size;
        expect(size).toBeGreaterThan(0);
    });

    it('creates plain tar when gzip is explicitly false', async () => {
        await tar(srcDir, outPlain, {
            gzip: false,
            compression: COMPRESSION_LEVEL.medium
        });

        expect(fs.existsSync(outPlain)).toBe(true);
        const size = fs.statSync(outPlain).size;
        expect(size).toBeGreaterThan(0);
    });
});
