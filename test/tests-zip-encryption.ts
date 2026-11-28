// test/tests-zip-encryption.ts
//
// Validates WinZip AES-256 (AE-2) ZIP encryption (the `password` option on
// zip()) against the bundled 7-Zip binary (7z-bin): archives open and extract
// with the correct password, are rejected with the wrong one, and carry the
// expected AES markers (method 99, encrypted flag, 0x9901 extra field). The
// encryption itself uses only Node's built-in crypto.
import {spawnSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {path7z} from '7z-bin';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {zip} from '../lib/ZipAFolder';

function run7z(args: string[]): {status: number | null; stdout: string} {
    const res = spawnSync(path7z, args, {encoding: 'utf8'});
    return {status: res.status, stdout: `${res.stdout ?? ''}${res.stderr ?? ''}`};
}

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

describe('ZIP AES-256 encryption (password)', () => {
    let tmpDir: string;
    const password = 'Str0ng P@ss — ünïcödé';

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zaf-zip-enc-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    const buildSource = (name: string, build: (src: string) => void): string => {
        const src = path.join(tmpDir, `src-${name}`);
        fs.mkdirSync(src, {recursive: true});
        build(src);
        return src;
    };

    it('creates a ZIP 7-Zip opens and extracts with the correct password', async () => {
        const src = buildSource('basic', (s) => {
            fs.mkdirSync(path.join(s, 'sub'), {recursive: true});
            fs.writeFileSync(path.join(s, 'a.txt'), 'secret alpha');
            fs.writeFileSync(path.join(s, 'sub', 'b.txt'), `secret beta ${'x'.repeat(500)}`);
            fs.writeFileSync(path.join(s, 'empty.txt'), '');
            fs.writeFileSync(path.join(s, 'Zoë.txt'), 'unicode name entry');
        });
        const out = path.join(tmpDir, 'basic.zip');
        const result = await zip(src, out, {password, compression: 'high'});
        expect(result.count).toBe(4);
        expect(result.size).toBe(fs.statSync(out).size);

        expect(run7z(['t', `-p${password}`, out]).stdout).toContain('Everything is Ok');

        const ext = path.join(tmpDir, 'basic-ext');
        fs.mkdirSync(ext, {recursive: true});
        expect(run7z(['x', '-y', `-p${password}`, `-o${ext}`, out]).status).toBe(0);
        for (const rel of listFiles(src)) {
            expect(fs.readFileSync(path.join(ext, rel)).equals(fs.readFileSync(path.join(src, rel)))).toBe(true);
        }
    });

    it('cannot be opened with the wrong password', async () => {
        const src = buildSource('wrongpw', (s) => {
            fs.writeFileSync(path.join(s, 'f.txt'), 'top secret payload '.repeat(50));
        });
        const out = path.join(tmpDir, 'wrongpw.zip');
        await zip(src, out, {password});

        const {status, stdout} = run7z(['t', '-pdefinitely-wrong', out]);
        expect(status).not.toBe(0);
        expect(stdout).not.toContain('Everything is Ok');
    });

    it('stores an AES entry (method 99, encrypted flag, 0x9901 extra field)', async () => {
        const src = buildSource('markers', (s) => {
            fs.writeFileSync(path.join(s, 'f.txt'), 'marker check');
        });
        const out = path.join(tmpDir, 'markers.zip');
        await zip(src, out, {password});

        const buf = fs.readFileSync(out);
        // Scan local file headers for the encrypted file entry (directories, if
        // any, are stored unencrypted and come first).
        const localSig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
        let found = false;
        for (let i = buf.indexOf(localSig); i >= 0; i = buf.indexOf(localSig, i + 1)) {
            if ((buf.readUInt16LE(i + 6) & 0x0001) === 0x0001) {
                expect(buf.readUInt16LE(i + 8)).toBe(99); // AES method
                found = true;
                break;
            }
        }
        expect(found).toBe(true);
        // The 0x9901 AES extra field is present somewhere in the archive.
        expect(buf.includes(Buffer.from([0x01, 0x99]))).toBe(true);
    });

    it('treats an empty password as no encryption', async () => {
        const src = buildSource('emptypw', (s) => {
            fs.writeFileSync(path.join(s, 'f.txt'), 'not encrypted');
        });
        const out = path.join(tmpDir, 'emptypw.zip');
        await zip(src, out, {password: ''});

        // Opens with no password, and no entry carries the encrypted flag.
        expect(run7z(['t', out]).stdout).toContain('Everything is Ok');
        const buf = fs.readFileSync(out);
        const i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        expect(buf.readUInt16LE(i + 6) & 0x0001).toBe(0x0000);
    });
});

describe('ZIP legacy ZipCrypto encryption (opt-in)', () => {
    let tmpDir: string;
    const password = 'legacy-pass-123';

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zaf-zip-zc-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    const buildSource = (name: string, build: (src: string) => void): string => {
        const src = path.join(tmpDir, `src-${name}`);
        fs.mkdirSync(src, {recursive: true});
        build(src);
        return src;
    };

    it('creates a ZipCrypto archive 7-Zip opens and extracts with the password', async () => {
        const src = buildSource('basic', (s) => {
            fs.mkdirSync(path.join(s, 'sub'), {recursive: true});
            fs.writeFileSync(path.join(s, 'a.txt'), 'legacy alpha');
            fs.writeFileSync(path.join(s, 'sub', 'b.txt'), `legacy beta ${'y'.repeat(400)}`);
            fs.writeFileSync(path.join(s, 'empty.txt'), '');
        });
        const out = path.join(tmpDir, 'basic.zip');
        const result = await zip(src, out, {password, encryptionMethod: 'zipcrypto'});
        expect(result.count).toBe(3);

        expect(run7z(['t', `-p${password}`, out]).stdout).toContain('Everything is Ok');

        const ext = path.join(tmpDir, 'basic-ext');
        fs.mkdirSync(ext, {recursive: true});
        expect(run7z(['x', '-y', `-p${password}`, `-o${ext}`, out]).status).toBe(0);
        for (const rel of listFiles(src)) {
            expect(fs.readFileSync(path.join(ext, rel)).equals(fs.readFileSync(path.join(src, rel)))).toBe(true);
        }
    });

    it('cannot be opened with the wrong password', async () => {
        const src = buildSource('wrongpw', (s) => {
            fs.writeFileSync(path.join(s, 'f.txt'), 'legacy secret '.repeat(50));
        });
        const out = path.join(tmpDir, 'wrongpw.zip');
        await zip(src, out, {password, encryptionMethod: 'zipcrypto'});

        const {status, stdout} = run7z(['t', '-pnope', out]);
        expect(status).not.toBe(0);
        expect(stdout).not.toContain('Everything is Ok');
    });

    it('sets the encrypted flag but keeps the real method and no AES extra field', async () => {
        const src = buildSource('markers', (s) => {
            fs.writeFileSync(path.join(s, 'f.txt'), 'legacy marker check');
        });
        const out = path.join(tmpDir, 'markers.zip');
        await zip(src, out, {password, encryptionMethod: 'zipcrypto'});

        const buf = fs.readFileSync(out);
        const localSig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
        let checked = false;
        for (let i = buf.indexOf(localSig); i >= 0; i = buf.indexOf(localSig, i + 1)) {
            if ((buf.readUInt16LE(i + 6) & 0x0001) === 0x0001) {
                // Real compression method (DEFLATE 8), NOT the AES method 99.
                expect(buf.readUInt16LE(i + 8)).toBe(8);
                checked = true;
                break;
            }
        }
        expect(checked).toBe(true);
        // ZipCrypto carries no WinZip AES (0x9901) extra field.
        expect(buf.includes(Buffer.from([0x01, 0x99]))).toBe(false);
    });
});
