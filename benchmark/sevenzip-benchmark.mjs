// benchmark/sevenzip-benchmark.mjs
//
// Local speed + compression comparison of zip-a-folder's native sevenZip()
// (via @napi-rs/lzma) against the 7z-bin binary (real 7-Zip), on a generated
// corpus. Run with: npm run benchmark
//
// 7z-bin is a devDependency used only for testing/benchmarking; it is NOT a
// runtime dependency of the library.
import {spawnSync} from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import {createRequire} from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import {sevenZip} from '../dist/ZipAFolder.mjs';

const require = createRequire(import.meta.url);
const {path7z} = require('7z-bin');

const RUNS = 5; // median of N timed runs per case
const LEVELS = [1, 5, 9];

function median(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function fmtMs(ms) {
    return `${ms.toFixed(0)} ms`;
}
function fmtPct(part, whole) {
    return `${((100 * part) / whole).toFixed(1)}%`;
}

function buildCorpus(dir) {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(dir, {recursive: true});
    let raw = 0;
    // Text: highly compressible, realistic source-like content.
    for (let i = 0; i < 40; i++) {
        let s = '';
        for (let j = 0; j < 1500; j++) {
            s += `export function handler_${i}_${j}(req, res) { return res.status(${j % 500}).json({ id: ${j}, ok: true }); }\n`;
        }
        const sub = path.join(dir, 'src', `module${i % 8}`);
        fs.mkdirSync(sub, {recursive: true});
        const buf = Buffer.from(s);
        fs.writeFileSync(path.join(sub, `file${i}.ts`), buf);
        raw += buf.length;
    }
    // Binary: incompressible random data.
    for (let i = 0; i < 6; i++) {
        const buf = crypto.randomBytes(512 * 1024);
        fs.writeFileSync(path.join(dir, `asset${i}.bin`), buf);
        raw += buf.length;
    }
    return raw;
}

async function timeZaf(src, out, level) {
    const times = [];
    let size = 0;
    for (let r = 0; r < RUNS; r++) {
        fs.rmSync(out, {force: true});
        const t0 = performance.now();
        const res = await sevenZip(src, out, {compressionLevel: level});
        times.push(performance.now() - t0);
        size = res.size;
    }
    return {ms: median(times), size};
}

function timeBin(src, out, level) {
    const times = [];
    for (let r = 0; r < RUNS; r++) {
        fs.rmSync(out, {force: true});
        const t0 = performance.now();
        // `a` add, `-mx<level>` compression level, single-threaded off by default.
        spawnSync(path7z, ['a', `-mx${level}`, out, `${src}/*`], {encoding: 'utf8'});
        times.push(performance.now() - t0);
    }
    return {ms: median(times), size: fs.statSync(out).size};
}

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaf-bench-'));
    const src = path.join(tmp, 'corpus');
    const raw = buildCorpus(src);

    const version = spawnSync(path7z, ['i'], {encoding: 'utf8'}).stdout.split('\n')[1].trim();
    console.log(`# zip-a-folder 7z benchmark`);
    console.log(`platform: ${os.type()} ${os.release()} ${os.arch()}, ${os.cpus().length} CPUs`);
    console.log(`node: ${process.version}`);
    console.log(`7-Zip: ${version}`);
    console.log(`corpus: ${(raw / 1024 / 1024).toFixed(2)} MiB (compressible text + random binary)`);
    console.log(`median of ${RUNS} runs\n`);

    console.log(
        '| level | zip-a-folder time | 7z-bin time | zip-a-folder size | 7z-bin size | size Δ (zaf vs 7z-bin) |'
    );
    console.log(
        '| ----- | ----------------- | ----------- | ----------------- | ----------- | ---------------------- |'
    );
    const rows = [];
    for (const level of LEVELS) {
        const z = await timeZaf(src, path.join(tmp, `z${level}.7z`), level);
        const b = timeBin(src, path.join(tmp, `b${level}.7z`), level);
        const sizeDelta = ((z.size - b.size) / b.size) * 100;
        rows.push({level, z, b, sizeDelta});
        console.log(
            `| ${level} | ${fmtMs(z.ms)} (${fmtPct(z.size, raw)}) | ${fmtMs(b.ms)} (${fmtPct(b.size, raw)}) | ${z.size} B | ${b.size} B | ${sizeDelta >= 0 ? '+' : ''}${sizeDelta.toFixed(1)}% |`
        );
    }

    fs.rmSync(tmp, {recursive: true, force: true});
    console.log('\n(Percentages next to times are compressed size as a fraction of the raw corpus.)');
}

main();
