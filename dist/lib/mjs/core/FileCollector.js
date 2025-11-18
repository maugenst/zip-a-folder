import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
export async function collectEntriesFromDirectory(rootDir, statConcurrency = 4) {
    const root = path.resolve(rootDir);
    const entries = [];
    const dirQueue = [{ fsPath: root, relPath: '' }];
    statConcurrency = Math.max(1, statConcurrency | 0);
    const worker = async () => {
        while (true) {
            const item = dirQueue.shift();
            if (!item) {
                break;
            }
            const dirents = await fs.promises.readdir(item.fsPath, { withFileTypes: true });
            for (const d of dirents) {
                const childFsPath = path.join(item.fsPath, d.name);
                const rel = item.relPath ? path.posix.join(item.relPath, d.name) : d.name;
                const stat = await fs.promises.stat(childFsPath);
                if (d.isDirectory()) {
                    const relDirPath = rel.endsWith('/') ? rel : rel + '/';
                    entries.push({
                        fsPath: childFsPath,
                        relativePath: relDirPath.replace(/\\/g, '/'),
                        isDirectory: true,
                        stat
                    });
                    dirQueue.push({ fsPath: childFsPath, relPath: rel });
                }
                else if (d.isFile()) {
                    entries.push({
                        fsPath: childFsPath,
                        relativePath: rel.replace(/\\/g, '/'),
                        isDirectory: false,
                        stat
                    });
                }
            }
        }
    };
    const workers = Array.from({ length: statConcurrency }, () => worker());
    await Promise.all(workers);
    return entries;
}
export async function collectGlobEntries(patterns, cwd, statConcurrency = 4) {
    const patternList = patterns
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    const matchedRelPaths = new Set();
    for (const pattern of patternList) {
        try {
            const matches = glob.sync(pattern, {
                cwd,
                nodir: true,
                strict: false,
                dot: false
            });
            for (const rel of matches) {
                matchedRelPaths.add(rel.replace(/\\/g, '/'));
            }
        }
        catch {
        }
    }
    const relPaths = Array.from(matchedRelPaths);
    if (relPaths.length === 0) {
        return [];
    }
    const entries = [];
    let index = 0;
    statConcurrency = Math.max(1, statConcurrency | 0);
    const worker = async () => {
        while (true) {
            const i = index++;
            if (i >= relPaths.length) {
                break;
            }
            const rel = relPaths[i];
            const abs = path.resolve(cwd, rel);
            const stat = await fs.promises.stat(abs);
            if (!stat.isFile()) {
                continue;
            }
            entries.push({
                fsPath: abs,
                relativePath: rel,
                isDirectory: false,
                stat
            });
        }
    };
    const workers = Array.from({ length: statConcurrency }, () => worker());
    await Promise.all(workers);
    return entries;
}
//# sourceMappingURL=FileCollector.js.map