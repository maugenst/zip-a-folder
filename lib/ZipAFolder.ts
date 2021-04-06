'use strict';
import {WriteStream} from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import * as fs from 'fs';

export enum COMPRESSION_LEVEL {
    uncompressed = 0,
    medium = 5,
    high = 9,
}

export class ZipAFolder {
    static async tar(srcFolder: string, zipFilePath: string, compression?: COMPRESSION_LEVEL): Promise<void | Error> {
        if (compression === undefined || compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress(srcFolder, zipFilePath, 'tar');
        } else {
            await ZipAFolder.compress(srcFolder, zipFilePath, 'tar', {
                gzip: true,
                gzipOptions: {level: compression},
            });
        }
    }

    static async zip(srcFolder: string, zipFilePath: string, compression?: COMPRESSION_LEVEL): Promise<void | Error> {
        if (compression === undefined || compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress(srcFolder, zipFilePath, 'zip', {
                store: true,
            });
        } else {
            await ZipAFolder.compress(srcFolder, zipFilePath, 'zip', {
                zlib: {level: compression},
            });
        }
    }

    private static async compress(
        srcFolder: string,
        zipFilePath: string,
        format: archiver.Format,
        archiverOptions?: archiver.ArchiverOptions
    ): Promise<void | Error> {
        const targetBasePath: string = path.dirname(zipFilePath);

        if (targetBasePath === srcFolder) {
            throw new Error('Source and target folder must be different.');
        }
        try {
            await fs.promises.access(srcFolder, fs.constants.R_OK | fs.constants.W_OK); //eslint-disable-line no-bitwise
            await fs.promises.access(targetBasePath, fs.constants.R_OK | fs.constants.W_OK); //eslint-disable-line no-bitwise
        } catch (e) {
            throw new Error(`Permission error: ${e.message}`);
        }

        const output: WriteStream = fs.createWriteStream(zipFilePath);
        const zipArchive: archiver.Archiver = archiver(format, archiverOptions || {});

        return new Promise((resolve, reject) => {
            output.on('close', resolve);
            output.on('error', reject);

            zipArchive.pipe(output);
            zipArchive.directory(srcFolder, false);
            zipArchive.finalize();
        });
    }
}

export const zip = ZipAFolder.zip;
export const tar = ZipAFolder.tar;
