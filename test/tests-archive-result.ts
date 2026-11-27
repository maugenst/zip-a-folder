// test/tests-archive-result.ts
//
// Covers github.com/maugenst/zip-a-folder/issues/80: zip(), tar() and
// sevenZip() resolve with { count, size } — the number of regular files
// written and the archive's byte size — uniformly across all formats.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {sevenZip, tar, zip} from '../lib/ZipAFolder';

describe('Archive result (count + size)', () => {
    let srcDir: string;
    let outDir: string;

    beforeAll(() => {
        srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zaf-result-src-'));
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zaf-result-out-'));
        fs.mkdirSync(path.join(srcDir, 'nested'), {recursive: true});
        fs.writeFileSync(path.join(srcDir, 'a.txt'), 'alpha');
        fs.writeFileSync(path.join(srcDir, 'b.txt'), 'bravo');
        fs.writeFileSync(path.join(srcDir, 'nested', 'c.txt'), 'charlie');
    });

    afterAll(() => {
        fs.rmSync(srcDir, {recursive: true, force: true});
        fs.rmSync(outDir, {recursive: true, force: true});
    });

    it('zip resolves with the file count and the on-disk size', async () => {
        const out = path.join(outDir, 'result.zip');
        const result = await zip(srcDir, out);
        expect(result.count).toBe(3); // three files; the directory is not counted
        expect(result.size).toBe(fs.statSync(out).size);
    });

    it('tar (gzip) resolves with the file count and the on-disk size', async () => {
        const out = path.join(outDir, 'result.tgz');
        const result = await tar(srcDir, out);
        expect(result.count).toBe(3);
        expect(result.size).toBe(fs.statSync(out).size);
    });

    it('tar (uncompressed) resolves with the file count and the on-disk size', async () => {
        const out = path.join(outDir, 'result.tar');
        const result = await tar(srcDir, out, {compressionType: 'none'});
        expect(result.count).toBe(3);
        expect(result.size).toBe(fs.statSync(out).size);
    });

    it('tar (brotli) resolves with the file count and the on-disk size', async () => {
        const out = path.join(outDir, 'result.tar.br');
        const result = await tar(srcDir, out, {compressionType: 'brotli'});
        expect(result.count).toBe(3);
        expect(result.size).toBe(fs.statSync(out).size);
    });

    it('sevenZip resolves with the file count and the on-disk size', async () => {
        const out = path.join(outDir, 'result.7z');
        const result = await sevenZip(srcDir, out);
        expect(result.count).toBe(3);
        expect(result.size).toBe(fs.statSync(out).size);
    });

    it('reports size for a custom write stream (no target path to stat)', async () => {
        const out = path.join(outDir, 'result-stream.zip');
        const result = await zip(srcDir, undefined, {customWriteStream: fs.createWriteStream(out)});
        expect(result.count).toBe(3);
        expect(result.size).toBe(fs.statSync(out).size);
    });

    it('counts only matched files for a glob source', async () => {
        // test/data/c holds exactly two .txt files (c1.txt, c2.txt).
        const out = path.join(outDir, 'result-glob.7z');
        const result = await sevenZip('test/data/c/*.txt', out);
        expect(result.count).toBe(2);
        expect(result.size).toBe(fs.statSync(out).size);
    });
});
