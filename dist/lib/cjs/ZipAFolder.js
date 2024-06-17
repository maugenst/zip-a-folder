'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.tar = exports.zip = exports.ZipAFolder = exports.COMPRESSION_LEVEL = void 0;
const tslib_1 = require("tslib");
const fs_1 = require("fs");
const path_1 = tslib_1.__importDefault(require("path"));
const archiver_1 = tslib_1.__importDefault(require("archiver"));
const promises_1 = tslib_1.__importDefault(require("fs/promises"));
const is_glob_1 = tslib_1.__importDefault(require("is-glob"));
const glob_1 = require("glob");
var COMPRESSION_LEVEL;
(function (COMPRESSION_LEVEL) {
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["uncompressed"] = 0] = "uncompressed";
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["medium"] = 5] = "medium";
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["high"] = 9] = "high";
})(COMPRESSION_LEVEL || (exports.COMPRESSION_LEVEL = COMPRESSION_LEVEL = {}));
class ZipAFolder {
    static tar(src, tarFilePath, zipAFolderOptions) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const o = zipAFolderOptions || {
                compression: COMPRESSION_LEVEL.high,
            };
            if (o.compression === COMPRESSION_LEVEL.uncompressed) {
                yield ZipAFolder.compress({ src, targetFilePath: tarFilePath, format: 'tar', zipAFolderOptions });
            }
            else {
                yield ZipAFolder.compress({
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
        });
    }
    static zip(src, zipFilePath, zipAFolderOptions) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const o = zipAFolderOptions || {
                compression: COMPRESSION_LEVEL.high,
            };
            if (o.compression === COMPRESSION_LEVEL.uncompressed) {
                yield ZipAFolder.compress({
                    src,
                    targetFilePath: zipFilePath,
                    format: 'zip',
                    zipAFolderOptions,
                    archiverOptions: {
                        store: true,
                    },
                });
            }
            else {
                yield ZipAFolder.compress({
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
        });
    }
    static compress(_a) {
        return tslib_1.__awaiter(this, arguments, void 0, function* ({ src, targetFilePath, format, zipAFolderOptions, archiverOptions, }) {
            let output;
            const globList = [];
            if (!(zipAFolderOptions === null || zipAFolderOptions === void 0 ? void 0 : zipAFolderOptions.customWriteStream) && targetFilePath) {
                const targetBasePath = path_1.default.dirname(targetFilePath);
                if (targetBasePath === src) {
                    throw new Error('Source and target folder must be different.');
                }
                try {
                    if (!(0, is_glob_1.default)(src)) {
                        yield promises_1.default.access(src, promises_1.default.constants.R_OK);
                    }
                    yield promises_1.default.access(targetBasePath, promises_1.default.constants.R_OK | promises_1.default.constants.W_OK);
                }
                catch (e) {
                    throw new Error(`Permission error: ${e.message}`);
                }
                if ((0, is_glob_1.default)(src)) {
                    for (const globPart of src.split(',')) {
                        globList.push(...(yield (0, glob_1.glob)(globPart.trim())));
                    }
                    if (globList.length === 0) {
                        throw new Error(`No glob match found for "${src}".`);
                    }
                }
                output = (0, fs_1.createWriteStream)(targetFilePath);
            }
            else if (zipAFolderOptions && zipAFolderOptions.customWriteStream) {
                output = zipAFolderOptions.customWriteStream;
            }
            else {
                throw new Error('You must either provide a target file path or a custom write stream to write to.');
            }
            const zipArchive = (0, archiver_1.default)(format, archiverOptions || {});
            return new Promise((resolve, reject) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                output.on('close', resolve);
                output.on('error', reject);
                zipArchive.pipe(output);
                if ((0, is_glob_1.default)(src)) {
                    for (const file of globList) {
                        if ((yield promises_1.default.lstat(file)).isFile()) {
                            const content = yield promises_1.default.readFile(file);
                            zipArchive.append(content, {
                                name: file,
                            });
                        }
                    }
                }
                else {
                    zipArchive.directory(src, (zipAFolderOptions === null || zipAFolderOptions === void 0 ? void 0 : zipAFolderOptions.destPath) || false);
                }
                yield zipArchive.finalize();
            }));
        });
    }
}
exports.ZipAFolder = ZipAFolder;
exports.zip = ZipAFolder.zip;
exports.tar = ZipAFolder.tar;
//# sourceMappingURL=ZipAFolder.js.map