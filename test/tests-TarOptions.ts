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

    it('keeps paths longer than 100 bytes', async () => {
        const longDir = path.join(tmpDir, 'long-src');
        const deep = path.join(
            longDir,
            'project/node_modules/@scope/some-package-name/dist/esm/components/forms/inputs'
        );
        fs.mkdirSync(deep, {recursive: true});
        fs.writeFileSync(path.join(deep, 'TextInputField.module.js'), 'hello');
        fs.writeFileSync(path.join(deep, 'TextInputField.module.css'), 'world');
        const out = path.join(tmpDir, 'long.tar');

        await tar(longDir, out, {gzip: false});

        // Read the entry names back, taking a PAX path record over the 100-byte name field
        const data = fs.readFileSync(out);
        const names: string[] = [];
        let paxPath: string | undefined;
        for (let offset = 0; offset + 512 <= data.length && data[offset] !== 0; ) {
            const size = parseInt(data.subarray(offset + 124, offset + 135).toString(), 8);
            const typeflag = String.fromCharCode(data[offset + 156]);
            const body = data.subarray(offset + 512, offset + 512 + size);
            if (typeflag === 'x') {
                paxPath = /\d+ path=(.*)\n/.exec(body.toString())?.[1];
            } else {
                names.push(
                    paxPath ??
                        data
                            .subarray(offset, offset + 100)
                            .toString()
                            .replace(/\0+$/, '')
                );
                paxPath = undefined;
            }
            offset += 512 + Math.ceil(size / 512) * 512;
        }

        const prefix = 'project/node_modules/@scope/some-package-name/dist/esm/components/forms/inputs/';
        expect(names).toContain(`${prefix}TextInputField.module.js`);
        expect(names).toContain(`${prefix}TextInputField.module.css`);
    });
});
