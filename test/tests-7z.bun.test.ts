// Bun test suite — mirrors all vitest tests but runs under bun:test.
// Also acts as a regression guard for github.com/maugenst/zip-a-folder/issues/73:
// if @napi-rs/lzma left open handles the process would hang after this suite
// finishes; CI catches that via `timeout 30 bun test ...`.
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {PassThrough, Writable} from 'stream';
import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import * as zlib from 'zlib';
import {collectEntriesFromDirectory, collectGlobEntries} from '../lib/core/FileCollector';
import {FileEntry} from '../lib/core/types';
import {crc32, dateToDosDate, dateToDosTime, looksLikeGlob, writeUInt64LE} from '../lib/core/utils';
import {NativeTar} from '../lib/tar/NativeTar';
import {COMPRESSION_LEVEL, sevenZip, tar, zip, ZipAFolder as zipafolder} from '../lib/ZipAFolder';
import {Native7z} from '../lib/7z/Native7z';
import {NativeZip} from '../lib/zip/NativeZip';

const testDir = path.join(import.meta.dir);
const testDataDir = path.join(import.meta.dir, 'data');
const testOutputDir = path.join(import.meta.dir, 'folder');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix: string) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeTmpTree(): string {
    const tmp = makeTmpDir('zaf-bun-excl-');
    fs.mkdirSync(path.join(tmp, 'dist'), {recursive: true});
    fs.mkdirSync(path.join(tmp, 'node_modules', 'dep'), {recursive: true});
    fs.mkdirSync(path.join(tmp, 'src'), {recursive: true});
    fs.mkdirSync(path.join(tmp, 'assets'), {recursive: true});
    fs.writeFileSync(path.join(tmp, 'src.txt'), 'root file');
    fs.writeFileSync(path.join(tmp, '.env'), 'SECRET=123');
    fs.writeFileSync(path.join(tmp, 'dist', 'bundle.js'), '(()=>{})()');
    fs.writeFileSync(path.join(tmp, 'node_modules', 'dep', 'index.js'), 'module.exports={}');
    fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export {}');
    fs.writeFileSync(path.join(tmp, 'src', '.hidden.ts'), '// hidden');
    fs.writeFileSync(path.join(tmp, 'assets', 'logo.png'), '\x89PNG');
    fs.writeFileSync(path.join(tmp, 'assets', 'styles.css'), 'body{}');
    return tmp;
}

async function zipToBuffer(zip: NativeZip): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', (c: Buffer) => chunks.push(c));
    await zip.writeToStream(stream);
    return Buffer.concat(chunks);
}

function parseCentralDirectory(buffer: Buffer) {
    const entries: Array<{name: string; versionMadeBy: number; externalAttrs: number}> = [];
    const eocdSig = 0x06054b50;
    for (let i = buffer.length - 22; i >= 0; i--) {
        if (buffer.readUInt32LE(i) === eocdSig) {
            const cdSize = buffer.readUInt32LE(i + 12);
            const cdOffset = buffer.readUInt32LE(i + 16);
            let p = cdOffset;
            const cdEnd = cdOffset + cdSize;
            while (p < cdEnd) {
                if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central header sig');
                const versionMadeBy = buffer.readUInt16LE(p + 4);
                const nameLen = buffer.readUInt16LE(p + 28);
                const extraLen = buffer.readUInt16LE(p + 30);
                const commentLen = buffer.readUInt16LE(p + 32);
                const externalAttrs = buffer.readUInt32LE(p + 38);
                const nameStart = p + 46;
                const name = buffer.slice(nameStart, nameStart + nameLen).toString('utf8');
                entries.push({name, versionMadeBy, externalAttrs});
                p = nameStart + nameLen + extraLen + commentLen;
            }
            break;
        }
    }
    return entries;
}

// ---------------------------------------------------------------------------
// 7z
// ---------------------------------------------------------------------------

describe('7z archive creation', () => {
    beforeAll(async () => {
        await fs.promises.mkdir(testOutputDir, {recursive: true});
    });

    afterAll(async () => {
        const files = await fs.promises.readdir(testOutputDir);
        for (const file of files) {
            if (file.endsWith('.7z')) {
                await fs.promises.unlink(path.join(testOutputDir, file)).catch(() => {});
            }
        }
    });

    it('process exits after sevenZip completes (no hanging handles — issue #73)', async () => {
        const targetPath = path.join(testOutputDir, 'test-bun.7z');
        await sevenZip(path.join(testDataDir, 'c'), targetPath);
        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);
        const fd = await fs.promises.open(targetPath, 'r');
        const buf = Buffer.alloc(6);
        await fd.read(buf, 0, 6, 0);
        await fd.close();
        expect(buf[0]).toBe(0x37);
        expect(buf[1]).toBe(0x7a);
        expect(buf[2]).toBe(0xbc);
        expect(buf[3]).toBe(0xaf);
        expect(buf[4]).toBe(0x27);
        expect(buf[5]).toBe(0x1c);
    });

    it('creates a 7z archive using ZipAFolder.sevenZip static method', async () => {
        const targetPath = path.join(testOutputDir, 'test-static.7z');
        await zipafolder.sevenZip(path.join(testDataDir, 'c'), targetPath);
        expect((await fs.promises.stat(targetPath)).size).toBeGreaterThan(0);
    });

    it('creates 7z archive with medium compression level', async () => {
        const targetPath = path.join(testOutputDir, 'test-medium.7z');
        await sevenZip(path.join(testDataDir, 'c'), targetPath, {compression: 'medium'});
        expect((await fs.promises.stat(targetPath)).size).toBeGreaterThan(0);
    });

    it('creates 7z archive with high compression level', async () => {
        const targetPath = path.join(testOutputDir, 'test-high.7z');
        await sevenZip(path.join(testDataDir, 'c'), targetPath, {compression: 'high'});
        expect((await fs.promises.stat(targetPath)).size).toBeGreaterThan(0);
    });

    it('creates 7z archive with explicit compressionLevel', async () => {
        const targetPath = path.join(testOutputDir, 'test-level.7z');
        await sevenZip(path.join(testDataDir, 'c'), targetPath, {compressionLevel: 9});
        expect((await fs.promises.stat(targetPath)).size).toBeGreaterThan(0);
    });

    it('creates 7z archive with uncompressed preset', async () => {
        const targetPath = path.join(testOutputDir, 'test-uncompressed.7z');
        await sevenZip(path.join(testDataDir, 'c'), targetPath, {compression: 'uncompressed'});
        expect((await fs.promises.stat(targetPath)).size).toBeGreaterThan(0);
    });

    it('supports custom write stream', async () => {
        const targetPath = path.join(testOutputDir, 'test-stream.7z');
        const writeStream = fs.createWriteStream(targetPath);
        await sevenZip(path.join(testDataDir, 'c'), undefined, {customWriteStream: writeStream});
        expect((await fs.promises.stat(targetPath)).size).toBeGreaterThan(0);
    });

    it('throws error when no target file or stream provided', async () => {
        await expect(sevenZip(path.join(testDataDir, 'c'))).rejects.toThrow(
            'You must either provide a target file path or a custom write stream to write to.'
        );
    });

    it('throws error for non-existent source directory', async () => {
        await expect(sevenZip('/nonexistent/directory', path.join(testOutputDir, 'x.7z'))).rejects.toThrow();
    });

    it('throws error when target is inside source directory', async () => {
        await expect(
            sevenZip(path.join(testDataDir, 'c'), path.join(testDataDir, 'c', 'test.7z'))
        ).rejects.toThrow('Source and target folder must be different.');
    });

    it('works with glob patterns', async () => {
        const targetPath = path.join(testOutputDir, 'test-glob.7z');
        await sevenZip('test/data/c/*.txt', targetPath);
        expect((await fs.promises.stat(targetPath)).size).toBeGreaterThan(0);
    });

    it('throws error for glob pattern with no matches', async () => {
        await expect(sevenZip('test/data/nonexistent/*.xyz', path.join(testOutputDir, 'x.7z'))).rejects.toThrow(
            'No glob match found'
        );
    });

    it('supports exclude patterns', async () => {
        const targetPath = path.join(testOutputDir, 'test-exclude.7z');
        await sevenZip(path.join(testDataDir, 'c'), targetPath, {exclude: ['**/c2.txt']});
        expect((await fs.promises.stat(targetPath)).size).toBeGreaterThan(0);
    });

    it('throws error when source is a file, not a directory', async () => {
        await expect(
            sevenZip(path.join(testDataDir, 'c', 'c1.txt'), path.join(testOutputDir, 'x.7z'))
        ).rejects.toThrow('Source must be a directory when no glob pattern is used.');
    });
});

describe('Native7z class direct tests', () => {
    it('throws error when creating empty archive', async () => {
        const archive = new Native7z();
        const writeStream = fs.createWriteStream(path.join(testOutputDir, 'test-empty-native.7z'));
        await expect(archive.writeToStream(writeStream)).rejects.toThrow('Cannot create empty 7z archive');
    });

    it('skips directory entries', async () => {
        const archive = new Native7z();
        await archive.addFile({
            relativePath: 'testdir',
            fsPath: testDataDir,
            stat: await fs.promises.stat(testDataDir),
            isDirectory: true
        });
        const writeStream = fs.createWriteStream(path.join(testOutputDir, 'test-dir-skip.7z'));
        await expect(archive.writeToStream(writeStream)).rejects.toThrow('Cannot create empty 7z archive');
    });

    it('respects compression level bounds', () => {
        expect(new Native7z(0)).toBeDefined();
        expect(new Native7z(10)).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// ZIP / TGZ
// ---------------------------------------------------------------------------

describe('Zip-A-Folder — zip and tar', () => {
    const testZIP = path.resolve(testDir, 'test.bun.zip');
    const testDestPathZIP = path.resolve(testDir, 'test.bun.destpath.zip');
    const testUNCOMPRESSEDZIP = path.resolve(testDir, 'testbun.UNCOMPRESSED.zip');
    const testMEDIUMZIP = path.resolve(testDir, 'testbun.MEDIUM.zip');
    const testSMALLZIP = path.resolve(testDir, 'testbun.SMALL.zip');
    const testGlobZIP = path.resolve(testDir, 'test.bun.globbed.zip');
    const testGlobMultiZIP = path.resolve(testDir, 'test.bun.globbed.multi.zip');
    const testTAR = path.resolve(testDir, 'test.bun.tgz');
    const testUNCOMPRESSEDTAR = path.resolve(testDir, 'testbun.UNCOMPRESSED.tar');
    const testMEDIUMTAR = path.resolve(testDir, 'testbun.MEDIUM.tgz');
    const testSMALLTAR = path.resolve(testDir, 'testbun.SMALL.tgz');
    const testGlobTAR = path.resolve(testDir, 'test.bun.globbed.tgz');
    const testGlobMultiTAR = path.resolve(testDir, 'test.bun.globbed.multi.tgz');
    const tempNativeFile = path.resolve(testDir, 'temp-native.bun.txt');

    beforeAll(() => {
        fs.writeFileSync(tempNativeFile, 'hello from native coverage\n');
    });

    afterAll(() => {
        const exts = ['.bun.zip', '.bun.tgz', '.bun.tar', 'testbun.'];
        for (const file of fs.readdirSync(testDir)) {
            if (exts.some((e) => file.includes(e)) || file === 'temp-native.bun.txt') {
                fs.rmSync(path.join(testDir, file), {force: true});
            }
        }
    });

    it('throws when no targetFilePath or customWriteStream', async () => {
        await expect(zipafolder.zip(path.resolve(testDir, 'data/'), undefined)).rejects.toThrow(
            /You must either provide a target file path or a custom write stream to write to./
        );
        await expect(zipafolder.tar(path.resolve(testDir, 'data/'), undefined)).rejects.toThrow(
            /You must either provide a target file path or a custom write stream to write to./
        );
    });

    it('ZIP: source and target in same directory throws', async () => {
        await expect(
            zipafolder.zip(path.resolve(testDir, 'data/'), path.resolve(testDir, 'data/test.zip'))
        ).rejects.toThrow(/Source and target folder must be different./);
    });

    it('ZIP: zips test folder', async () => {
        await zipafolder.zip(path.resolve(testDir, 'data/'), testZIP);
        expect(fs.existsSync(testZIP)).toBe(true);
    });

    it('ZIP: compression levels produce expected size ordering', async () => {
        await zipafolder.zip(path.resolve(testDir, 'data/'), testUNCOMPRESSEDZIP, {
            compression: COMPRESSION_LEVEL.uncompressed
        });
        await zipafolder.zip(path.resolve(testDir, 'data/'), testMEDIUMZIP, {compression: COMPRESSION_LEVEL.medium});
        await zipafolder.zip(path.resolve(testDir, 'data/'), testSMALLZIP, {compression: COMPRESSION_LEVEL.high});
        expect(fs.statSync(testMEDIUMZIP).size).toBeLessThan(fs.statSync(testUNCOMPRESSEDZIP).size);
        expect(fs.statSync(testSMALLZIP).size).toBeLessThan(fs.statSync(testMEDIUMZIP).size);
    });

    it('ZIP: destPath option', async () => {
        await zip(path.resolve(testDir, 'data/'), testDestPathZIP, {destPath: 'data/'});
        expect(fs.existsSync(testDestPathZIP)).toBe(true);
    });

    it('ZIP: non-existent source throws', async () => {
        expect.assertions(1);
        try {
            await zipafolder.zip(path.resolve(testDir, 'notexisting/'), testZIP);
        } catch (e: any) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });

    it('ZIP: non-existent target folder throws', async () => {
        expect.assertions(1);
        try {
            await zipafolder.zip(path.resolve(testDir, 'data/'), '/notexisting/testcallback.zip');
        } catch (e: any) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });

    it('ZIP: glob pattern', async () => {
        await zip('test/**/*.json', testGlobZIP);
        expect(fs.existsSync(testGlobZIP)).toBe(true);
    });

    it('ZIP: glob with no matches throws', async () => {
        await expect(zip('test/bar/**/*.json', 'THISWILLNEVEREXIST.bun.zip')).rejects.toThrow(/No glob match found/);
        expect(fs.existsSync('THISWILLNEVEREXIST.bun.zip')).toBe(false);
    });

    it('ZIP: multi-path glob', async () => {
        await zip('**/*.json, **/*.txt', testGlobMultiZIP);
        expect(fs.existsSync(testGlobMultiZIP)).toBe(true);
    });

    it('ZIP: custom write stream', async () => {
        const out = path.resolve(testDir, 'test.bun.customws.zip');
        await zipafolder.zip(path.resolve(testDir, 'data/'), undefined, {customWriteStream: fs.createWriteStream(out)});
        expect(fs.existsSync(out)).toBeTruthy();
    });

    it('ZIP: respects user-provided zlib level', async () => {
        const out = path.resolve(testDir, 'test.bun.zlib-level.zip');
        await zip(path.resolve(testDir, 'data/'), out, {compression: COMPRESSION_LEVEL.high, zlib: {level: 3}});
        expect(fs.existsSync(out)).toBe(true);
    });

    it('ZIP: weird compression enum hits default branch', async () => {
        const out = path.resolve(testDir, 'test.bun.weird-compression.zip');
        // @ts-expect-error intentionally invalid
        await zipafolder.zip(path.resolve(testDir, 'data/'), out, {compression: 999});
        expect(fs.existsSync(out)).toBe(true);
    });

    it('ZIP: forceZip64 + namePrependSlash + comment', async () => {
        const out = path.resolve(testDir, 'test.bun.zip64.zip');
        await zip(path.resolve(testDir, 'data/'), out, {
            forceZip64: true,
            namePrependSlash: true,
            comment: 'bun-zip64-test',
            compression: COMPRESSION_LEVEL.medium
        });
        expect(fs.existsSync(out)).toBe(true);
    });

    it('ZIP: STORE via store=true', async () => {
        const out = path.resolve(testDir, 'test.bun.store.zip');
        await zip(path.resolve(testDir, 'data/'), out, {store: true, compression: COMPRESSION_LEVEL.uncompressed});
        expect(fs.existsSync(out)).toBe(true);
    });

    it('ZIP: source is a file throws', async () => {
        await expect(
            zipafolder.zip(path.resolve(testDir, 'data/json/test.json'), testZIP)
        ).rejects.toThrow(/Source must be a directory when no glob pattern is used./);
    });

    it('TGZ: source and target in same directory throws', async () => {
        await expect(
            zipafolder.tar(path.resolve(testDir, 'data/'), path.resolve(testDir, 'data/test.tgz'))
        ).rejects.toThrow(/Source and target folder must be different./);
    });

    it('TGZ: tars test folder', async () => {
        await zipafolder.tar(path.resolve(testDir, 'data/'), testTAR);
        expect(fs.existsSync(testTAR)).toBe(true);
    });

    it('TGZ: compression levels produce expected size ordering', async () => {
        await zipafolder.tar(path.resolve(testDir, 'data/'), testUNCOMPRESSEDTAR, {
            compression: COMPRESSION_LEVEL.uncompressed
        });
        await zipafolder.tar(path.resolve(testDir, 'data/'), testMEDIUMTAR, {compression: COMPRESSION_LEVEL.medium});
        await zipafolder.tar(path.resolve(testDir, 'data/'), testSMALLTAR, {compression: COMPRESSION_LEVEL.high});
        expect(fs.statSync(testMEDIUMTAR).size).toBeLessThan(fs.statSync(testUNCOMPRESSEDTAR).size);
        expect(fs.statSync(testSMALLTAR).size).toBeLessThan(fs.statSync(testMEDIUMTAR).size);
    });

    it('TGZ: non-existent source throws', async () => {
        expect.assertions(1);
        try {
            await zipafolder.tar(path.resolve(testDir, 'notexisting/'), testTAR);
        } catch (e: any) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });

    it('TGZ: custom write stream', async () => {
        const out = path.resolve(testDir, 'test.bun.customws.tgz');
        await zipafolder.tar(path.resolve(testDir, 'data/'), undefined, {customWriteStream: fs.createWriteStream(out)});
        expect(fs.existsSync(out)).toBeTruthy();
    });

    it('TGZ: glob pattern', async () => {
        await tar('**/*.json', testGlobTAR);
        expect(fs.existsSync(testGlobTAR)).toBe(true);
    });

    it('TGZ: multi-path glob', async () => {
        await tar('**/*.json, **/*.txt', testGlobMultiTAR);
        expect(fs.existsSync(testGlobMultiTAR)).toBe(true);
    });

    it('TGZ: glob with no matches throws', async () => {
        await expect(tar('test/inaccessible/**/*.json', 'THISWILLNEVEREXIST.bun.tgz')).rejects.toThrow(
            /No glob match found/
        );
        expect(fs.existsSync('THISWILLNEVEREXIST.bun.tgz')).toBe(false);
    });

    it('TGZ: weird compression enum hits default branch', async () => {
        const out = path.resolve(testDir, 'test.bun.weird-compression.tgz');
        // @ts-expect-error intentionally invalid
        await zipafolder.tar(path.resolve(testDir, 'data/'), out, {compression: 999});
        expect(fs.existsSync(out)).toBe(true);
    });

    it('TGZ: gzip=false with non-uncompressed compression', async () => {
        const out = path.resolve(testDir, 'test.bun.nogzip-medium.tar');
        await tar(path.resolve(testDir, 'data/'), out, {gzip: false, compression: COMPRESSION_LEVEL.medium});
        expect(fs.existsSync(out)).toBe(true);
    });

    it('TGZ: source is a file throws', async () => {
        await expect(
            zipafolder.tar(path.resolve(testDir, 'data/json/test.json'), testTAR)
        ).rejects.toThrow(/Source must be a directory when no glob pattern is used./);
    });

    it('NativeTar: finalize writes trailer blocks', async () => {
        const chunks: Buffer[] = [];
        const mem = new Writable({write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); }});
        const tarImpl = new NativeTar(mem as any);
        const stat = fs.statSync(tempNativeFile);
        await tarImpl.addFile({fsPath: tempNativeFile, relativePath: 'file1.txt', isDirectory: false, stat});
        await tarImpl.finalize();
        expect(chunks.reduce((s, b) => s + b.length, 0)).toBeGreaterThan(stat.size);
    });

    it('NativeTar: addDirectory without trailing slash adds it automatically', async () => {
        const chunks: Buffer[] = [];
        const mem = new Writable({write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); }});
        const tarImpl = new NativeTar(mem as any);
        const stat = fs.statSync(path.resolve(testDir, 'data'));
        await tarImpl.addDirectory({fsPath: path.resolve(testDir, 'data'), relativePath: 'data', isDirectory: true, stat});
        await tarImpl.finalize();
        expect(chunks.reduce((s, b) => s + b.length, 0)).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Tar options
// ---------------------------------------------------------------------------

describe('Tar options', () => {
    let tmpDir: string;
    beforeAll(() => { tmpDir = makeTmpDir('zaf-bun-tar-opts-'); });
    afterAll(() => { fs.rmSync(tmpDir, {recursive: true, force: true}); });

    it('creates gzipped tar with custom gzipOptions', async () => {
        const out = path.join(tmpDir, 'test.tgz');
        await tar(testDataDir, out, {gzip: true, compression: COMPRESSION_LEVEL.high, gzipOptions: {chunkSize: 64 * 1024}});
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });

    it('creates plain tar when gzip is explicitly false', async () => {
        const out = path.join(tmpDir, 'test.plain.tar');
        await tar(testDataDir, out, {gzip: false, compression: COMPRESSION_LEVEL.medium});
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Brotli
// ---------------------------------------------------------------------------

describe('Brotli compression for TAR archives', () => {
    let tmpDir: string;
    beforeAll(() => { tmpDir = makeTmpDir('zaf-bun-brotli-'); });
    afterAll(() => { fs.rmSync(tmpDir, {recursive: true, force: true}); });

    it('creates brotli-compressed tar', async () => {
        const out = path.join(tmpDir, 'test.tar.br');
        await tar(testDataDir, out, {compressionType: 'brotli'});
        const compressed = fs.readFileSync(out);
        expect(zlib.brotliDecompressSync(compressed).length).toBeGreaterThan(compressed.length);
    });

    it('brotli with medium compression level', async () => {
        const out = path.join(tmpDir, 'test.medium.tar.br');
        await tar(testDataDir, out, {compressionType: 'brotli', compression: COMPRESSION_LEVEL.medium});
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });

    it('brotli with high compression level', async () => {
        const out = path.join(tmpDir, 'test.high.tar.br');
        await tar(testDataDir, out, {compressionType: 'brotli', compression: COMPRESSION_LEVEL.high});
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });

    it('brotli with custom brotliOptions', async () => {
        const out = path.join(tmpDir, 'test.custom.tar.br');
        await tar(testDataDir, out, {
            compressionType: 'brotli',
            brotliOptions: {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT}}
        });
        expect(() => zlib.brotliDecompressSync(fs.readFileSync(out))).not.toThrow();
    });

    it('brotli smaller than uncompressed tar', async () => {
        const outBr = path.join(tmpDir, 'compare.tar.br');
        const outPlain = path.join(tmpDir, 'compare.tar');
        await tar(testDataDir, outBr, {compressionType: 'brotli', compression: COMPRESSION_LEVEL.high});
        await tar(testDataDir, outPlain, {compressionType: 'none'});
        expect(fs.statSync(outBr).size).toBeLessThan(fs.statSync(outPlain).size);
    });

    it('compressionType none creates uncompressed tar', async () => {
        const out = path.join(tmpDir, 'none.tar');
        await tar(testDataDir, out, {compressionType: 'none'});
        expect(fs.readFileSync(out)[0]).not.toBe(0x1f);
    });

    it('compression=uncompressed overrides compressionType brotli', async () => {
        const out = path.join(tmpDir, 'override.tar');
        await tar(testDataDir, out, {compressionType: 'brotli', compression: COMPRESSION_LEVEL.uncompressed});
        expect(() => zlib.brotliDecompressSync(fs.readFileSync(out))).toThrow();
    });

    it('brotli with custom write stream', async () => {
        const out = path.join(tmpDir, 'stream.tar.br');
        await tar(testDataDir, undefined, {compressionType: 'brotli', customWriteStream: fs.createWriteStream(out)});
        expect(() => zlib.brotliDecompressSync(fs.readFileSync(out))).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Coverage gap tests
// ---------------------------------------------------------------------------

describe('Coverage gap tests', () => {
    let tmpDir: string;
    beforeAll(() => { tmpDir = makeTmpDir('zaf-bun-coverage-'); });
    afterAll(() => { fs.rmSync(tmpDir, {recursive: true, force: true}); });

    it('ZIP: medium compression with pre-set zlib.level does not override', async () => {
        const out = path.join(tmpDir, 'medium-preset-level.zip');
        await zip(testDataDir, out, {compression: COMPRESSION_LEVEL.medium, zlib: {level: 7}});
        expect(fs.existsSync(out)).toBe(true);
    });

    it('ZIP: destPath "/" reduces to empty prefix', async () => {
        const out = path.join(tmpDir, 'destpath-slash.zip');
        await zip(testDataDir, out, {destPath: '/'});
        expect(fs.existsSync(out)).toBe(true);
    });

    it('TGZ: medium compression with pre-set gzipOptions.level does not override', async () => {
        const out = path.join(tmpDir, 'medium-preset-gzip-level.tgz');
        await tar(testDataDir, out, {compression: COMPRESSION_LEVEL.medium, gzipOptions: {level: 3}});
        expect(fs.existsSync(out)).toBe(true);
    });

    it('TGZ brotli: medium compression with pre-set BROTLI_PARAM_QUALITY does not override', async () => {
        const out = path.join(tmpDir, 'brotli-preset-quality-medium.tar.br');
        await tar(testDataDir, out, {
            compressionType: 'brotli',
            compression: COMPRESSION_LEVEL.medium,
            brotliOptions: {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 3}}
        });
        expect(() => zlib.brotliDecompressSync(fs.readFileSync(out))).not.toThrow();
    });

    it('TGZ brotli: high compression with pre-set BROTLI_PARAM_QUALITY does not override', async () => {
        const out = path.join(tmpDir, 'brotli-preset-quality-high.tar.br');
        await tar(testDataDir, out, {
            compressionType: 'brotli',
            compression: COMPRESSION_LEVEL.high,
            brotliOptions: {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 2}}
        });
        expect(() => zlib.brotliDecompressSync(fs.readFileSync(out))).not.toThrow();
    });

    it('NativeTar: 512-byte-aligned file writes no padding block', async () => {
        const alignedFile = path.join(tmpDir, 'aligned512.bin');
        fs.writeFileSync(alignedFile, Buffer.alloc(512, 0xab));
        const chunks: Buffer[] = [];
        const mem = new Writable({write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); }});
        const stat = fs.statSync(alignedFile);
        const tarWriter = new NativeTar(mem as any);
        await tarWriter.addFile({fsPath: alignedFile, relativePath: 'aligned512.bin', isDirectory: false, stat});
        await tarWriter.finalize();
        expect(chunks.reduce((s, b) => s + b.length, 0)).toBe(512 * 4);
    });

    it('NativeZip: writeToStream catch block on synchronous throw', async () => {
        const zipper = new NativeZip({store: true});
        const tmpFile = path.join(tmpDir, 'tiny.txt');
        fs.writeFileSync(tmpFile, 'x');
        const stat = fs.statSync(tmpFile);
        await zipper.addFileFromFs(tmpFile, 'tiny.txt', stat.mtime, stat.mode);

        class SyncThrowWritable extends Writable {
            _write(_chunk: any, _enc: BufferEncoding, _cb: (e?: Error | null) => void): void {
                throw new Error('sync-throw-from-write');
            }
        }
        const badStream = new SyncThrowWritable();
        badStream.on('error', () => {});
        await expect(zipper.writeToStream(badStream as any)).rejects.toThrow('sync-throw-from-write');
    });
});

// ---------------------------------------------------------------------------
// Zip options
// ---------------------------------------------------------------------------

describe('Zip options', () => {
    let tmpDir: string;
    beforeAll(() => { tmpDir = makeTmpDir('zaf-bun-zip-opts-'); });
    afterAll(() => { fs.rmSync(tmpDir, {recursive: true, force: true}); });

    it('creates zip with comment, forceZip64, namePrependSlash', async () => {
        const out = path.join(tmpDir, 'test.options.zip');
        await zip(testDataDir, out, {comment: 'test-comment', forceZip64: true, namePrependSlash: true, compression: COMPRESSION_LEVEL.medium});
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });

    it('creates uncompressed (STORE) zip', async () => {
        const out = path.join(tmpDir, 'test.store.zip');
        await zip(testDataDir, out, {store: true, compression: COMPRESSION_LEVEL.uncompressed});
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// ZIP mode and version fields (NativeZip)
// ---------------------------------------------------------------------------

describe('ZIP mode and version fields', () => {
    it('writes Unix version-made-by and stores mode in external attributes', async () => {
        const tmp = makeTmpDir('zaf-bun-zipmode-');
        try {
            const dirPath = path.join(tmp, 'subdir');
            fs.mkdirSync(dirPath);
            fs.chmodSync(dirPath, 0o755);
            const filePath = path.join(tmp, 'hello.txt');
            fs.writeFileSync(filePath, 'hello');
            fs.chmodSync(filePath, 0o644);

            const nzip = new NativeZip();
            nzip.addDirectoryEntry('subdir/', new Date(), 0o755);
            await nzip.addFileFromFs(filePath, 'hello.txt', new Date(), 0o644);

            const buf = await zipToBuffer(nzip);
            const entries = parseCentralDirectory(buf);
            const fileEntry = entries.find((e) => e.name === 'hello.txt')!;
            const dirEntry = entries.find((e) => e.name === 'subdir/' || e.name === 'subdir')!;

            expect(((fileEntry.versionMadeBy >> 8) & 0xff)).toBe(3);
            expect(((dirEntry.versionMadeBy >> 8) & 0xff)).toBe(3);
            expect((fileEntry.externalAttrs >>> 16) & 0o7777).toBe(0o644);
            expect((dirEntry.externalAttrs >>> 16) & 0o7777).toBe(0o755);
            expect((dirEntry.externalAttrs & 0x10) === 0x10).toBe(true);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    it('addDirectoryEntry adds trailing slash when missing', async () => {
        const nzip = new NativeZip();
        nzip.addDirectoryEntry('mydir', new Date(), 0o755);
        const buf = await zipToBuffer(nzip);
        const entries = parseCentralDirectory(buf);
        expect(entries[0].name).toBe('mydir/');
    });
});

// ---------------------------------------------------------------------------
// FileCollector
// ---------------------------------------------------------------------------

describe('FileCollector', () => {
    it('collectEntriesFromDirectory: returns files, dirs, normalizes separators, ignores symlinks', async () => {
        const tmp = makeTmpDir('bun-fc-test-');
        try {
            const dirA = path.join(tmp, 'a');
            const dirB = path.join(tmp, 'b');
            const dirC = path.join(dirB, 'c');
            fs.mkdirSync(dirA); fs.mkdirSync(dirB); fs.mkdirSync(dirC);
            fs.writeFileSync(path.join(dirA, 'a1.txt'), 'a1');
            fs.writeFileSync(path.join(tmp, 'b.txt'), 'b');
            fs.writeFileSync(path.join(dirC, 'c1.txt'), 'c1');
            try { fs.symlinkSync(path.join(tmp, 'b.txt'), path.join(tmp, 'link')); } catch {}

            const entries = await collectEntriesFromDirectory(tmp, 2);
            const names = entries.map((e) => e.relativePath).sort();
            expect(names).toEqual(['a/', 'a/a1.txt', 'b.txt', 'b/', 'b/c/', 'b/c/c1.txt']);
            for (const e of entries) expect(e.relativePath.includes('\\')).toBe(false);
            expect(names.includes('link')).toBe(false);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    it('collectGlobEntries: respects patterns, returns files only, no-match yields []', async () => {
        const tmp = makeTmpDir('bun-fc-glob-');
        try {
            fs.mkdirSync(path.join(tmp, 'd'));
            fs.writeFileSync(path.join(tmp, 'one.txt'), '1');
            fs.writeFileSync(path.join(tmp, 'two.md'), '2');
            fs.writeFileSync(path.join(tmp, 'd', 'inner.txt'), '3');
            fs.writeFileSync(path.join(tmp, '.hidden.txt'), 'h');

            const entriesTxt = await collectGlobEntries('*.txt, d/*.txt', tmp, 2);
            expect(entriesTxt.map((e) => e.relativePath).sort()).toEqual(['d/inner.txt', 'one.txt']);
            expect(await collectGlobEntries('nope-*.xyz', tmp, 2)).toEqual([]);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    it('collectGlobEntries: handles malformed glob pattern gracefully', async () => {
        const tmp = makeTmpDir('bun-fc-bad-');
        try {
            expect(await collectGlobEntries('[', tmp, 2)).toEqual([]);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    it('collectEntriesFromDirectory: normalizes non-positive statConcurrency to 1', async () => {
        const tmp = makeTmpDir('bun-fc-conc-');
        try {
            fs.mkdirSync(path.join(tmp, 'x'));
            fs.writeFileSync(path.join(tmp, 'x', 'f.txt'), 'f');
            const names = (await collectEntriesFromDirectory(tmp, 0)).map((e) => e.relativePath).sort();
            expect(names).toEqual(['x/', 'x/f.txt']);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    it('collectEntriesFromDirectory: skips Unix sockets', async () => {
        const tmp = makeTmpDir('bun-fc-socket-');
        try {
            fs.writeFileSync(path.join(tmp, 'regular.txt'), 'hello');
            const sockPath = path.join(tmp, 'test.sock');
            const server = net.createServer();
            await new Promise<void>((resolve) => server.listen(sockPath, resolve));
            server.close();
            const names = (await collectEntriesFromDirectory(tmp, 1)).map((e) => e.relativePath).sort();
            expect(names).toEqual(['regular.txt']);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });
});

// ---------------------------------------------------------------------------
// FileCollector – exclude option
// ---------------------------------------------------------------------------

describe('FileCollector – exclude option', () => {
    let tmp: string;
    beforeAll(() => { tmp = makeTmpTree(); });
    afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

    it('no exclude returns all entries', async () => {
        const names = (await collectEntriesFromDirectory(tmp, 4)).map((e) => e.relativePath).sort();
        expect(names).toContain('dist/');
        expect(names).toContain('dist/bundle.js');
        expect(names).toContain('.env');
    });

    it('exclude single directory by glob', async () => {
        const names = (await collectEntriesFromDirectory(tmp, 4, ['dist/**', 'dist/'])).map((e) => e.relativePath).sort();
        expect(names).not.toContain('dist/');
        expect(names).toContain('src/app.ts');
    });

    it('exclude multiple directories', async () => {
        const names = (await collectEntriesFromDirectory(tmp, 4, ['dist/**', 'dist/', 'node_modules/**', 'node_modules/'])).map((e) => e.relativePath).sort();
        expect(names).not.toContain('dist/bundle.js');
        expect(names).not.toContain('node_modules/dep/index.js');
        expect(names).toContain('src/app.ts');
    });

    it('exclude dot-files', async () => {
        const names = (await collectEntriesFromDirectory(tmp, 4, ['**/.*', '**/.*/**'])).map((e) => e.relativePath).sort();
        expect(names).not.toContain('.env');
        expect(names).toContain('src/app.ts');
    });

    it('exclude by file extension', async () => {
        const names = (await collectEntriesFromDirectory(tmp, 4, ['**/*.js'])).map((e) => e.relativePath).sort();
        expect(names).not.toContain('dist/bundle.js');
        expect(names).toContain('src/app.ts');
    });

    it('empty exclude array is a no-op', async () => {
        const a = (await collectEntriesFromDirectory(tmp, 4, [])).map((e) => e.relativePath).sort();
        const b = (await collectEntriesFromDirectory(tmp, 4, undefined)).map((e) => e.relativePath).sort();
        expect(a).toEqual(b);
    });

    it('collectGlobEntries: exclude filters matching files', async () => {
        const names = (await collectGlobEntries('**/*.js', tmp, 4, ['node_modules/**'])).map((e) => e.relativePath).sort();
        expect(names).toContain('dist/bundle.js');
        expect(names).not.toContain('node_modules/dep/index.js');
    });
});

// ---------------------------------------------------------------------------
// zip/tar – exclude integration
// ---------------------------------------------------------------------------

describe('zip/tar – exclude option', () => {
    let tmp: string;
    let outDir: string;
    beforeAll(() => { tmp = makeTmpTree(); outDir = makeTmpDir('zaf-bun-out-'); });
    afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); fs.rmSync(outDir, {recursive: true, force: true}); });

    it('ZIP: exclude removes directories from archive', async () => {
        const out = path.join(outDir, 'excl-dir.zip');
        await zip(tmp, out, {exclude: ['dist/**', 'dist/', 'node_modules/**', 'node_modules/']});
        const outFull = path.join(outDir, 'full.zip');
        await zip(tmp, outFull);
        expect(fs.statSync(out).size).toBeLessThan(fs.statSync(outFull).size);
    });

    it('ZIP: exclude dot-files', async () => {
        const out = path.join(outDir, 'no-dotfiles.zip');
        await zip(tmp, out, {exclude: ['**/.*', '**/.*/**']});
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });

    it('ZIP: exclude empty array is a no-op', async () => {
        const out = path.join(outDir, 'excl-empty.zip');
        await zip(tmp, out, {exclude: []});
        expect(fs.statSync(out).size).toBe(fs.statSync(path.join(outDir, 'full.zip')).size);
    });

    it('TGZ: exclude removes directories', async () => {
        const out = path.join(outDir, 'excl-dir.tgz');
        await tar(tmp, out, {exclude: ['dist/**', 'dist/', 'node_modules/**', 'node_modules/']});
        const outFull = path.join(outDir, 'full.tgz');
        await tar(tmp, outFull);
        expect(fs.statSync(out).size).toBeLessThan(fs.statSync(outFull).size);
    });

    it('TGZ: exclude dot-files', async () => {
        const out = path.join(outDir, 'no-dotfiles.tgz');
        await tar(tmp, out, {exclude: ['**/.*', '**/.*/**']});
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Core utils
// ---------------------------------------------------------------------------

describe('core utils', () => {
    it('crc32 is deterministic and matches known value', () => {
        const buf = Buffer.from('hello');
        expect(crc32(buf)).toBe(crc32(buf));
        expect(crc32(buf)).toBe(0x3610a686);
    });

    it('dateToDosDate / dateToDosTime return numbers', () => {
        const d = new Date(Date.UTC(2020, 0, 2, 3, 4, 10));
        expect(dateToDosTime(d, false)).toBeGreaterThan(0);
        expect(dateToDosDate(d, false)).toBeGreaterThan(0);
        expect(typeof dateToDosTime(d, true)).toBe('number');
        expect(typeof dateToDosDate(d, true)).toBe('number');
    });

    it('writeUInt64LE writes correct low/high words', () => {
        const buf = Buffer.alloc(16, 0);
        writeUInt64LE(buf, 0x1_00000010, 0);
        expect(buf.readUInt32LE(0)).toBe(16);
        expect(buf.readUInt32LE(4)).toBe(1);
    });

    it('looksLikeGlob detects glob patterns', () => {
        expect(looksLikeGlob('**/*.json')).toBe(true);
        expect(looksLikeGlob('foo/*.txt')).toBe(true);
        expect(looksLikeGlob('no/glob/here.txt')).toBe(false);
    });
});
