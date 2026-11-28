// test/tests-7z-validation.ts
//
// Regression guard for github.com/maugenst/zip-a-folder/issues/81:
// the previous Native7z writer emitted an XZ-container stream behind an LZMA1
// coder with no coder properties and a broken variable-length number encoder,
// so every 7z archive failed to open ("Headers Error"). These tests build real
// archives and validate them with the bundled 7-Zip binary (7z-bin), then
// extract and compare contents — the only reliable proof the container is
// well-formed. The library itself still compresses purely via @napi-rs/lzma.
import {spawnSync} from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {path7z} from '7z-bin';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {sevenZip} from '../lib/ZipAFolder';

/** Run the bundled 7-Zip binary and return {status, stdout}. */
function run7z(args: string[]): {status: number | null; stdout: string} {
    const res = spawnSync(path7z, args, {encoding: 'utf8'});
    return {status: res.status, stdout: `${res.stdout ?? ''}${res.stderr ?? ''}`};
}

/** Recursively list files under a directory as sorted POSIX-relative paths. */
function listFiles(dir: string, base = ''): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const rel = path.posix.join(base, entry.name);
        if (entry.isDirectory()) {
            out.push(...listFiles(path.join(dir, entry.name), rel));
        } else {
            out.push(rel);
        }
    }
    return out.sort();
}

describe('7z archive validation (real 7-Zip)', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zaf-7z-valid-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    /** Build an archive from `build(src)`, assert `7z t` passes, and return the paths. */
    async function buildAndTest(name: string, build: (src: string) => void): Promise<{src: string; out: string}> {
        const src = path.join(tmpDir, `src-${name}`);
        fs.mkdirSync(src, {recursive: true});
        build(src);
        const out = path.join(tmpDir, `${name}.7z`);
        await sevenZip(src, out);

        const {status, stdout} = run7z(['t', out]);
        expect(stdout).toContain('Everything is Ok');
        expect(status).toBe(0);
        return {src, out};
    }

    /** Extract `out` and assert every file under `src` round-trips byte-for-byte. */
    function expectRoundTrip(src: string, out: string, name: string): void {
        const ext = path.join(tmpDir, `ext-${name}`);
        fs.mkdirSync(ext, {recursive: true});
        const {status} = run7z(['x', '-y', `-o${ext}`, out]);
        expect(status).toBe(0);

        const files = listFiles(src);
        expect(files.length).toBeGreaterThan(0);
        for (const rel of files) {
            const original = fs.readFileSync(path.join(src, rel));
            const extracted = fs.readFileSync(path.join(ext, rel));
            expect(extracted.equals(original)).toBe(true);
        }
    }

    it('produces a 7z archive 7-Zip can open (single file)', async () => {
        const {src, out} = await buildAndTest('single', (s) => {
            fs.writeFileSync(path.join(s, 'only.txt'), 'just one file');
        });
        expectRoundTrip(src, out, 'single');
    });

    it('round-trips nested directories with forward-slash paths', async () => {
        const {src, out} = await buildAndTest('nested', (s) => {
            fs.mkdirSync(path.join(s, 'sub', 'deep'), {recursive: true});
            fs.writeFileSync(path.join(s, 'a.txt'), 'content of a');
            fs.writeFileSync(path.join(s, 'sub', 'b.txt'), 'content of b');
            fs.writeFileSync(path.join(s, 'sub', 'deep', 'c.txt'), 'content of c');
        });
        expectRoundTrip(src, out, 'nested');

        // Paths must be stored with forward slashes so they extract as nested
        // directories on every platform (backslashes become literal names).
        const {stdout} = run7z(['l', '-slt', out]);
        expect(stdout).toContain('sub/b.txt');
        expect(stdout).not.toContain('sub\\b.txt');
    });

    it('round-trips a zero-byte file', async () => {
        const {src, out} = await buildAndTest('empty', (s) => {
            fs.writeFileSync(path.join(s, 'data.txt'), 'payload');
            fs.writeFileSync(path.join(s, 'empty.txt'), '');
        });
        expectRoundTrip(src, out, 'empty');
    });

    it('round-trips unicode file names', async () => {
        const {src, out} = await buildAndTest('unicode', (s) => {
            fs.writeFileSync(path.join(s, 'héllo-wörld.txt'), 'ünïcödé');
            fs.writeFileSync(path.join(s, '日本語.txt'), 'テスト');
        });
        expectRoundTrip(src, out, 'unicode');
    });

    // Exercises the 7z variable-length number encoder for values >= 128:
    // the substream sizes, the folder unpack size and the packed size all
    // exceed one byte here. A bug in that encoder reproduces issue #81 for any
    // archive larger than ~127 bytes.
    it('round-trips multiple large files (multi-byte number encoding)', async () => {
        const {src, out} = await buildAndTest('large', (s) => {
            fs.writeFileSync(path.join(s, 'a.bin'), crypto.randomBytes(5000));
            fs.writeFileSync(path.join(s, 'b.bin'), crypto.randomBytes(9000));
            fs.writeFileSync(path.join(s, 'c.txt'), 'lorem ipsum '.repeat(2000));
        });
        expectRoundTrip(src, out, 'large');
    });

    it('round-trips many files across directories', async () => {
        const {src, out} = await buildAndTest('many', (s) => {
            for (let i = 0; i < 60; i++) {
                const d = path.join(s, `d${i % 5}`);
                fs.mkdirSync(d, {recursive: true});
                fs.writeFileSync(path.join(d, `f${i}.dat`), crypto.randomBytes(200 + i));
            }
        });
        expectRoundTrip(src, out, 'many');
    });

    it('stays valid across every compression level', async () => {
        for (const level of [1, 5, 9]) {
            const src = path.join(tmpDir, `lvl-${level}-src`);
            fs.mkdirSync(src, {recursive: true});
            for (let i = 0; i < 5; i++) {
                fs.writeFileSync(path.join(src, `f${i}.txt`), 'compress me '.repeat(500));
            }
            const out = path.join(tmpDir, `lvl-${level}.7z`);
            await sevenZip(src, out, {compressionLevel: level});
            const {status, stdout} = run7z(['t', out]);
            expect(stdout).toContain('Everything is Ok');
            expect(status).toBe(0);
        }
    });

    it('compresses a solid archive smaller than the raw input', async () => {
        const src = path.join(tmpDir, 'ratio-src');
        fs.mkdirSync(src, {recursive: true});
        let raw = 0;
        for (let i = 0; i < 10; i++) {
            const body = `repeatable payload line ${i} `.repeat(400);
            fs.writeFileSync(path.join(src, `f${i}.txt`), body);
            raw += Buffer.byteLength(body);
        }
        const out = path.join(tmpDir, 'ratio.7z');
        const result = await sevenZip(src, out, {compression: 'high'});
        expect(result.size).toBeLessThan(raw);
        expect(run7z(['t', out]).stdout).toContain('Everything is Ok');
    });

    // An explicit numeric compressionLevel must take precedence over the
    // `compression` preset instead of being silently overridden (issue #83).
    it('lets an explicit compressionLevel win over the compression preset', async () => {
        const src = path.join(tmpDir, 'precedence-src');
        fs.mkdirSync(src, {recursive: true});
        // Varied (not trivially repetitive) content, so levels 1 and 9 produce
        // measurably different sizes and "which one wins" is observable.
        for (let i = 0; i < 10; i++) {
            let body = '';
            for (let j = 0; j < 800; j++) {
                body += `row ${i}-${j}: ${((j * 2654435761) >>> 0).toString(36)} value=${(i * j) % 7} tag_${j % 50}\n`;
            }
            fs.writeFileSync(path.join(src, `f${i}.txt`), body);
        }

        const sizeFor = async (opts: Parameters<typeof sevenZip>[2]): Promise<number> => {
            const out = path.join(tmpDir, 'precedence.7z');
            const result = await sevenZip(src, out, opts);
            expect(run7z(['t', out]).stdout).toContain('Everything is Ok');
            return result.size;
        };

        const level9 = await sizeFor({compressionLevel: 9});
        const level1 = await sizeFor({compressionLevel: 1});
        // Sanity: the numeric scale is live — level 9 compresses this payload
        // clearly better than level 1.
        expect(level9).toBeLessThan(level1);

        // With both options set, the numeric level wins: pairing level 9 with
        // the weakest preset lands in the level-9 size range, not the level-1
        // one. (Exact bytes aren't asserted — the native LZMA encoder is not
        // byte-deterministic run to run — but the L1/L9 gap dwarfs that jitter.)
        const bothLevel9 = await sizeFor({compressionLevel: 9, compression: 'uncompressed'});
        const midpoint = (level1 + level9) / 2;
        expect(bothLevel9).toBeLessThan(midpoint);
    });

    // Password-protected archives (issue #83): AES-256 `7zAES` coder, decryptable
    // by real 7-Zip with the password and rejected with a wrong one.
    describe('AES-256 encryption (password)', () => {
        const password = 'Str0ng P@ss — ünïcödé';

        const buildEncrypted = (name: string, build: (src: string) => void): {src: string; out: string} => {
            const src = path.join(tmpDir, `enc-src-${name}`);
            fs.mkdirSync(src, {recursive: true});
            build(src);
            const out = path.join(tmpDir, `enc-${name}.7z`);
            return {src, out};
        };

        it('creates an archive 7-Zip opens and extracts with the correct password', async () => {
            const {src, out} = buildEncrypted('basic', (s) => {
                fs.mkdirSync(path.join(s, 'sub'), {recursive: true});
                fs.writeFileSync(path.join(s, 'a.txt'), 'secret alpha');
                fs.writeFileSync(path.join(s, 'sub', 'b.txt'), `secret beta ${'x'.repeat(500)}`);
                fs.writeFileSync(path.join(s, 'empty.txt'), '');
            });
            const result = await sevenZip(src, out, {password, compression: 'high'});
            expect(result.count).toBe(3);
            expect(result.size).toBe(fs.statSync(out).size);

            // Valid with the right password.
            expect(run7z(['t', `-p${password}`, out]).stdout).toContain('Everything is Ok');

            // Extract and verify every file round-trips byte-for-byte.
            const ext = path.join(tmpDir, 'enc-ext-basic');
            fs.mkdirSync(ext, {recursive: true});
            expect(run7z(['x', '-y', `-p${password}`, `-o${ext}`, out]).status).toBe(0);
            for (const rel of listFiles(src)) {
                expect(fs.readFileSync(path.join(ext, rel)).equals(fs.readFileSync(path.join(src, rel)))).toBe(true);
            }
        });

        it('cannot be opened with the wrong password', async () => {
            const {src, out} = buildEncrypted('wrongpw', (s) => {
                fs.writeFileSync(path.join(s, 'f.txt'), 'top secret payload '.repeat(50));
            });
            await sevenZip(src, out, {password});

            // 7-Zip reports a non-zero status and does not confirm success.
            const {status, stdout} = run7z(['t', '-pdefinitely-wrong', out]);
            expect(status).not.toBe(0);
            expect(stdout).not.toContain('Everything is Ok');
        });

        it('treats an empty password as no encryption', async () => {
            const {src, out} = buildEncrypted('emptypw', (s) => {
                fs.writeFileSync(path.join(s, 'f.txt'), 'not encrypted');
            });
            await sevenZip(src, out, {password: ''});
            // Opens with no password at all.
            expect(run7z(['t', out]).stdout).toContain('Everything is Ok');
        });
    });
});
