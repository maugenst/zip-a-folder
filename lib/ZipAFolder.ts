'use strict';
import {WriteStream, createWriteStream} from 'fs';
import path from 'path';
import archiver from 'archiver';
import fs from 'fs/promises';
import isGlob from 'is-glob';
import {glob} from 'glob';
import {Stats} from 'node:fs';

export enum COMPRESSION_LEVEL {
    uncompressed = 0,
    medium = 5,
    high = 9,
}

/**
 * Options to pass in to zip a folder
 * compression default is 'high'
 */
export type ZipAFolderOptions = {
    compression?: COMPRESSION_LEVEL;
    customWriteStream?: WriteStream;
    destPath?: string;
};

export class ZipAFolder {
    /**
     * Tars a given folder or a glob into a gzipped tar archive.
     * If no zipAFolderOptions are passed in, the default compression level is high.
     * @param src can be a string path or a glob
     * @param tarFilePath path to the zip file
     * @param zipAFolderOptions
     */
    static async tar(
        src: string,
        tarFilePath: string | undefined,
        zipAFolderOptions?: ZipAFolderOptions,
    ): Promise<void | Error> {
        const o: ZipAFolderOptions = zipAFolderOptions || {
            compression: COMPRESSION_LEVEL.high,
        };

        if (o.compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress({src, targetFilePath: tarFilePath, format: 'tar', zipAFolderOptions});
        } else {
            await ZipAFolder.compress({
                src,
                targetFilePath: tarFilePath,
                format: 'tar',
                zipAFolderOptions,
                archiverOptions: {
                    gzip: true,
                    gzipOptions: {
                        level: o.compression,
                    },
                },
            });
        }
    }

    /**
     * Zips a given folder or a glob into a zip archive.
     * If no zipAFolderOptions are passed in, the default compression level is high.
     * @param src can be a string path or a glob
     * @param zipFilePath path to the zip file
     * @param zipAFolderOptions
     */
    static async zip(
        src: string,
        zipFilePath: string | undefined,
        zipAFolderOptions?: ZipAFolderOptions,
    ): Promise<void | Error> {
        const o: ZipAFolderOptions = zipAFolderOptions || {
            compression: COMPRESSION_LEVEL.high,
        };

        if (o.compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress({
                src,
                targetFilePath: zipFilePath,
                format: 'zip',
                zipAFolderOptions,
                archiverOptions: {
                    store: true,
                },
            });
        } else {
            await ZipAFolder.compress({
                src,
                targetFilePath: zipFilePath,
                format: 'zip',
                zipAFolderOptions,
                archiverOptions: {
                    zlib: {
                        level: o.compression,
                    },
                },
            });
        }
    }

    private static async compress({
        src,
        targetFilePath,
        format,
        zipAFolderOptions,
        archiverOptions,
    }: {
        src: string;
        targetFilePath?: string;
        format: archiver.Format;
        zipAFolderOptions?: ZipAFolderOptions;
        archiverOptions?: archiver.ArchiverOptions;
    }): Promise<void | Error> {
        let output: WriteStream;
        const globList: string[] = [];

        if (!zipAFolderOptions?.customWriteStream && targetFilePath) {
            const targetBasePath: string = path.dirname(targetFilePath);

            if (targetBasePath === src) {
                throw new Error('Source and target folder must be different.');
            }

            try {
                if (!isGlob(src)) {
                    await fs.access(src, fs.constants.R_OK); //eslint-disable-line no-bitwise
                }
                await fs.access(targetBasePath, fs.constants.R_OK | fs.constants.W_OK); //eslint-disable-line no-bitwise
            } catch (e: any) {
                throw new Error(`Permission error: ${e.message}`);
            }

            if (isGlob(src)) {
                for (const globPart of src.split(',')) {
                    // @ts-ignore
                    globList.push(...(await glob(globPart.trim())));
                }
                if (globList.length === 0) {
                    throw new Error(`No glob match found for "${src}".`);
                }
            }

            output = createWriteStream(targetFilePath);
        } else if (zipAFolderOptions && zipAFolderOptions.customWriteStream) {
            output = zipAFolderOptions.customWriteStream;
        } else {
            throw new Error('You must either provide a target file path or a custom write stream to write to.');
        }

        const zipArchive: archiver.Archiver = archiver(format, archiverOptions || {});

        return new Promise(async (resolve, reject) => {
            output.on('close', resolve);
            output.on('error', reject);

            zipArchive.pipe(output);

            if (isGlob(src)) {
                for (const file of globList) {
                    if (((await fs.lstat(file)) as Stats).isFile()) {
                        const content = await fs.readFile(file);
                        zipArchive.append(content, {
                            name: file,
                        });
                    }
                }
            } else {
                zipArchive.directory(src, zipAFolderOptions?.destPath || false);
            }
            await zipArchive.finalize();
        });
    }
}

export const zip = ZipAFolder.zip;
export const tar = ZipAFolder.tar;
