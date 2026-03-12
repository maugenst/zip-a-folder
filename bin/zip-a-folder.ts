import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import {zip, tar, sevenZip} from '../lib/ZipAFolder.js';
import type {ZipArchiveOptions, TarArchiveOptions, SevenZipArchiveOptions, COMPRESSION_LEVELS} from '../lib/core/types.js';

const VERSION = '6.0.1';

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
};

// Spinner frames for progress
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface CLIOptions {
    verbose: boolean;
    quiet: boolean;
    compression: COMPRESSION_LEVELS;
    compressionLevel?: number;
    exclude: string[];
    destPath?: string;
    help: boolean;
    version: boolean;
}

function printHelp(): void {
    console.log(`
${colors.bold}${colors.cyan}zip-a-folder${colors.reset} - Compress folders into ZIP/TAR/TGZ/BR/7z archives

${colors.bold}USAGE:${colors.reset}
    zip-a-folder <source> <target> [options]

${colors.bold}ARGUMENTS:${colors.reset}
    ${colors.green}<source>${colors.reset}     Source folder path or glob pattern
    ${colors.green}<target>${colors.reset}     Target archive path (extension determines format)

${colors.bold}SUPPORTED FORMATS:${colors.reset}
    ${colors.yellow}.zip${colors.reset}        ZIP archive (deflate compression)
    ${colors.yellow}.tar${colors.reset}        TAR archive (uncompressed)
    ${colors.yellow}.tgz${colors.reset}        TAR archive with gzip compression
    ${colors.yellow}.tar.gz${colors.reset}     TAR archive with gzip compression
    ${colors.yellow}.tar.br${colors.reset}     TAR archive with brotli compression
    ${colors.yellow}.7z${colors.reset}         7z archive with LZMA compression

${colors.bold}OPTIONS:${colors.reset}
    ${colors.cyan}-h, --help${colors.reset}              Show this help message
    ${colors.cyan}-V, --version${colors.reset}           Show version number
    ${colors.cyan}-v, --verbose${colors.reset}           Show detailed progress (files being processed)
    ${colors.cyan}-q, --quiet${colors.reset}             Suppress all output except errors
    ${colors.cyan}-c, --compression${colors.reset} <level>
                            Compression preset: high, medium, uncompressed
                            (default: high)
    ${colors.cyan}-l, --level${colors.reset} <number>    Compression level (1-9, format-specific)
    ${colors.cyan}-e, --exclude${colors.reset} <pattern> Glob pattern to exclude (can be used multiple times)
    ${colors.cyan}-d, --dest-path${colors.reset} <path>  Destination path prefix inside archive

${colors.bold}EXAMPLES:${colors.reset}
    ${colors.dim}# Create a ZIP archive${colors.reset}
    zip-a-folder ./my-folder ./archive.zip

    ${colors.dim}# Create a gzipped TAR with verbose output${colors.reset}
    zip-a-folder ./src ./backup.tgz -v

    ${colors.dim}# Create a 7z archive with maximum compression${colors.reset}
    zip-a-folder ./project ./project.7z -c high

    ${colors.dim}# Create archive excluding node_modules${colors.reset}
    zip-a-folder ./app ./app.zip -e "node_modules/**" -e "**/*.log"

    ${colors.dim}# Create brotli-compressed TAR${colors.reset}
    zip-a-folder ./data ./data.tar.br -v

    ${colors.dim}# Use glob patterns${colors.reset}
    zip-a-folder "src/**/*.ts" ./source.zip

${colors.bold}OUTPUT:${colors.reset}
    By default, shows a summary with compression ratio.
    Use ${colors.cyan}-v${colors.reset} for detailed file-by-file progress.
    Use ${colors.cyan}-q${colors.reset} to suppress all output.
`);
}

function printVersion(): void {
    console.log(`zip-a-folder v${VERSION}`);
}

function parseArgs(args: string[]): {source?: string; target?: string; options: CLIOptions} {
    const options: CLIOptions = {
        verbose: false,
        quiet: false,
        compression: 'high',
        exclude: [],
        help: false,
        version: false,
    };

    let source: string | undefined;
    let target: string | undefined;
    const positional: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '-h' || arg === '--help') {
            options.help = true;
        } else if (arg === '-V' || arg === '--version') {
            options.version = true;
        } else if (arg === '-v' || arg === '--verbose') {
            options.verbose = true;
        } else if (arg === '-q' || arg === '--quiet') {
            options.quiet = true;
        } else if (arg === '-c' || arg === '--compression') {
            const level = args[++i];
            if (level === 'high' || level === 'medium' || level === 'uncompressed') {
                options.compression = level;
            } else {
                console.error(`${colors.red}Error:${colors.reset} Invalid compression level: ${level}`);
                console.error('Valid options: high, medium, uncompressed');
                process.exit(1);
            }
        } else if (arg === '-l' || arg === '--level') {
            const level = Number.parseInt(args[++i], 10);
            if (Number.isNaN(level) || level < 1 || level > 9) {
                console.error(`${colors.red}Error:${colors.reset} Invalid compression level: must be 1-9`);
                process.exit(1);
            }
            options.compressionLevel = level;
        } else if (arg === '-e' || arg === '--exclude') {
            options.exclude.push(args[++i]);
        } else if (arg === '-d' || arg === '--dest-path') {
            options.destPath = args[++i];
        } else if (!arg.startsWith('-')) {
            positional.push(arg);
        } else {
            console.error(`${colors.red}Error:${colors.reset} Unknown option: ${arg}`);
            console.error('Use --help to see available options');
            process.exit(1);
        }
    }

    if (positional.length >= 1) source = positional[0];
    if (positional.length >= 2) target = positional[1];

    return {source, target, options};
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function getArchiveType(targetPath: string): 'zip' | 'tar' | 'tgz' | 'tar.br' | '7z' | null {
    const lowerPath = targetPath.toLowerCase();
    if (lowerPath.endsWith('.zip')) return 'zip';
    if (lowerPath.endsWith('.tar.br')) return 'tar.br';
    if (lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tgz')) return 'tgz';
    if (lowerPath.endsWith('.tar')) return 'tar';
    if (lowerPath.endsWith('.7z')) return '7z';
    return null;
}

async function getSourceSize(sourcePath: string): Promise<number> {
    let totalSize = 0;

    async function walkDir(dir: string): Promise<void> {
        try {
            const stat = await fs.promises.stat(dir);
            if (stat.isFile()) {
                totalSize += stat.size;
                return;
            }

            const entries = await fs.promises.readdir(dir);
            for (const entry of entries) {
                await walkDir(path.join(dir, entry));
            }
        } catch {
            // Ignore errors (permission denied, etc.)
        }
    }

    // Check if it's a glob pattern
    if (sourcePath.includes('*') || sourcePath.includes('?')) {
        // For glob patterns, we'll estimate after compression
        return 0;
    }

    await walkDir(sourcePath);
    return totalSize;
}

async function countFiles(sourcePath: string): Promise<number> {
    let count = 0;

    async function walkDir(dir: string): Promise<void> {
        try {
            const stat = await fs.promises.stat(dir);
            if (stat.isFile()) {
                count++;
                return;
            }

            const entries = await fs.promises.readdir(dir);
            for (const entry of entries) {
                await walkDir(path.join(dir, entry));
            }
        } catch {
            // Ignore errors
        }
    }

    if (!sourcePath.includes('*') && !sourcePath.includes('?')) {
        await walkDir(sourcePath);
    }

    return count;
}

class ProgressReporter {
    private verbose: boolean;
    private quiet: boolean;
    private spinnerIndex = 0;
    private interval?: ReturnType<typeof setInterval>;
    private filesProcessed = 0;
    private totalFiles = 0;
    private startTime: number;

    constructor(verbose: boolean, quiet: boolean, totalFiles: number) {
        this.verbose = verbose;
        this.quiet = quiet;
        this.totalFiles = totalFiles;
        this.startTime = Date.now();
    }

    start(archiveType: string, source: string, target: string): void {
        if (this.quiet) return;

        console.log(`\n${colors.bold}${colors.cyan}📦 zip-a-folder${colors.reset}`);
        console.log(`${colors.dim}───────────────────────────────────────${colors.reset}`);
        console.log(`${colors.green}Source:${colors.reset}  ${source}`);
        console.log(`${colors.green}Target:${colors.reset}  ${target}`);
        console.log(`${colors.green}Format:${colors.reset}  ${archiveType.toUpperCase()}`);
        if (this.totalFiles > 0) {
            console.log(`${colors.green}Files:${colors.reset}   ${this.totalFiles}`);
        }
        console.log(`${colors.dim}───────────────────────────────────────${colors.reset}`);

        if (!this.verbose) {
            // Start spinner for non-verbose mode
            process.stdout.write(`\n${colors.cyan}${spinnerFrames[0]}${colors.reset} Compressing...`);
            this.interval = setInterval(() => {
                this.spinnerIndex = (this.spinnerIndex + 1) % spinnerFrames.length;
                process.stdout.write(`\r${colors.cyan}${spinnerFrames[this.spinnerIndex]}${colors.reset} Compressing...`);
            }, 80);
        } else {
            console.log(`\n${colors.bold}Processing files:${colors.reset}`);
        }
    }

    file(relativePath: string, size: number): void {
        this.filesProcessed++;

        if (this.verbose && !this.quiet) {
            const sizeStr = formatBytes(size).padStart(10);
            console.log(`  ${colors.dim}${sizeStr}${colors.reset}  ${relativePath}`);
        }
    }

    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            process.stdout.write('\r' + ' '.repeat(30) + '\r');
        }
    }

    summary(sourceSize: number, targetSize: number): void {
        if (this.quiet) return;

        const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
        const ratio = sourceSize > 0 ? ((1 - targetSize / sourceSize) * 100).toFixed(1) : 'N/A';

        console.log(`\n${colors.dim}───────────────────────────────────────${colors.reset}`);
        console.log(`${colors.bold}${colors.green}✓ Compression complete!${colors.reset}`);
        console.log(`${colors.dim}───────────────────────────────────────${colors.reset}`);

        if (sourceSize > 0) {
            console.log(`${colors.yellow}Original size:${colors.reset}    ${formatBytes(sourceSize)}`);
            console.log(`${colors.yellow}Compressed size:${colors.reset}  ${formatBytes(targetSize)}`);
            console.log(`${colors.yellow}Compression:${colors.reset}      ${colors.green}${ratio}%${colors.reset} reduction`);
        } else {
            console.log(`${colors.yellow}Archive size:${colors.reset}     ${formatBytes(targetSize)}`);
        }

        console.log(`${colors.yellow}Time:${colors.reset}             ${duration}s`);
        if (this.filesProcessed > 0) {
            console.log(`${colors.yellow}Files:${colors.reset}            ${this.filesProcessed}`);
        }
        console.log();
    }

    error(message: string): void {
        this.stop();
        console.error(`\n${colors.red}✗ Error:${colors.reset} ${message}\n`);
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const {source, target, options} = parseArgs(args);

    if (options.help) {
        printHelp();
        process.exit(0);
    }

    if (options.version) {
        printVersion();
        process.exit(0);
    }

    if (!source || !target) {
        console.error(`${colors.red}Error:${colors.reset} Missing required arguments`);
        console.error('Usage: zip-a-folder <source> <target> [options]');
        console.error('Use --help for more information');
        process.exit(1);
    }

    const archiveType = getArchiveType(target);
    if (!archiveType) {
        console.error(`${colors.red}Error:${colors.reset} Unsupported archive format`);
        console.error('Supported formats: .zip, .tar, .tgz, .tar.gz, .tar.br, .7z');
        process.exit(1);
    }

    // Get source size and file count for progress reporting
    const sourceSize = await getSourceSize(source);
    const fileCount = await countFiles(source);

    const progress = new ProgressReporter(options.verbose, options.quiet, fileCount);

    try {
        progress.start(archiveType, source, target);

        const baseOptions = {
            compression: options.compression,
            exclude: options.exclude.length > 0 ? options.exclude : undefined,
            destPath: options.destPath,
        };

        switch (archiveType) {
            case 'zip': {
                const zipOptions: ZipArchiveOptions = {
                    ...baseOptions,
                    zlib: options.compressionLevel ? {level: options.compressionLevel} : undefined,
                };
                await zip(source, target, zipOptions);
                break;
            }
            case 'tar': {
                const tarOptions: TarArchiveOptions = {
                    ...baseOptions,
                    compressionType: 'none',
                };
                await tar(source, target, tarOptions);
                break;
            }
            case 'tgz': {
                const tgzOptions: TarArchiveOptions = {
                    ...baseOptions,
                    compressionType: 'gzip',
                    gzipOptions: options.compressionLevel ? {level: options.compressionLevel} : undefined,
                };
                await tar(source, target, tgzOptions);
                break;
            }
            case 'tar.br': {
                const brOptions: TarArchiveOptions = {
                    ...baseOptions,
                    compressionType: 'brotli',
                    brotliOptions: options.compressionLevel
                        ? {
                              params: {
                                  [zlib.constants.BROTLI_PARAM_QUALITY]: options.compressionLevel,
                              },
                          }
                        : undefined,
                };
                await tar(source, target, brOptions);
                break;
            }
            case '7z': {
                const sevenZipOptions: SevenZipArchiveOptions = {
                    ...baseOptions,
                    compressionLevel: options.compressionLevel,
                };
                await sevenZip(source, target, sevenZipOptions);
                break;
            }
        }

        progress.stop();

        // Get the compressed file size
        const targetStat = await fs.promises.stat(target);
        progress.summary(sourceSize, targetStat.size);
    } catch (error) {
        progress.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main();