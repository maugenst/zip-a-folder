// test/tests-progress.ts
//
// Covers the onProgress callback (requested in issue #83): zip(), tar() and
// sevenZip() report archiving progress as a monotonic integer percent that
// starts above 0, never decreases, stays within 0–100, and ends at exactly 100.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {sevenZip, tar, zip} from '../lib/ZipAFolder';

describe('onProgress reporting', () => {
    let tmp: string;
    let src: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaf-progress-'));
        src = path.join(tmp, 'src');
        fs.mkdirSync(path.join(src, 'sub'), {recursive: true});
        // Enough files/bytes that progress advances in several steps.
        for (let i = 0; i < 16; i++) {
            fs.writeFileSync(path.join(src, 'sub', `f${i}.bin`), crypto.randomBytes(100_000));
        }
    });

    afterAll(() => {
        fs.rmSync(tmp, {recursive: true, force: true});
    });

    const assertValidSeries = (pcts: number[]): void => {
        expect(pcts.length).toBeGreaterThan(0);
        expect(pcts[0]).toBeGreaterThan(0); // never reports a leading 0
        expect(pcts.at(-1)).toBe(100); // always ends at 100
        for (let i = 0; i < pcts.length; i++) {
            expect(pcts[i]).toBeGreaterThanOrEqual(0);
            expect(pcts[i]).toBeLessThanOrEqual(100);
            if (i > 0) {
                expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]); // monotonic
            }
        }
    };

    it('zip reports monotonic progress ending at 100', async () => {
        const pcts: number[] = [];
        await zip(src, path.join(tmp, 'p.zip'), {onProgress: (p) => pcts.push(p)});
        assertValidSeries(pcts);
    });

    it('tar reports monotonic progress ending at 100', async () => {
        const pcts: number[] = [];
        await tar(src, path.join(tmp, 'p.tgz'), {onProgress: (p) => pcts.push(p)});
        assertValidSeries(pcts);
    });

    it('sevenZip reports monotonic progress ending at 100', async () => {
        const pcts: number[] = [];
        await sevenZip(src, path.join(tmp, 'p.7z'), {onProgress: (p) => pcts.push(p)});
        assertValidSeries(pcts);
    });

    it('emits exactly one 100 for an archive of only empty files', async () => {
        const emptySrc = path.join(tmp, 'empty');
        fs.mkdirSync(emptySrc, {recursive: true});
        fs.writeFileSync(path.join(emptySrc, 'a.txt'), '');
        fs.writeFileSync(path.join(emptySrc, 'b.txt'), '');

        const pcts: number[] = [];
        await zip(emptySrc, path.join(tmp, 'empty.zip'), {onProgress: (p) => pcts.push(p)});
        expect(pcts).toEqual([100]);
    });

    it('works without a callback (no throw, archive still created)', async () => {
        const out = path.join(tmp, 'nocb.zip');
        await zip(src, out);
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });
});
