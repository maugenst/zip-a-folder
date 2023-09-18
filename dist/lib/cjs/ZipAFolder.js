"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    COMPRESSION_LEVEL: function() {
        return COMPRESSION_LEVEL;
    },
    ZipAFolder: function() {
        return ZipAFolder;
    },
    zip: function() {
        return zip;
    },
    tar: function() {
        return tar;
    }
});
var _path = /*#__PURE__*/ _interop_require_default(require("path"));
var _archiver = /*#__PURE__*/ _interop_require_default(require("archiver"));
var _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
var _isglob = /*#__PURE__*/ _interop_require_default(require("is-glob"));
var _glob = require("glob");
function _array_like_to_array(arr, len) {
    if (len == null || len > arr.length) len = arr.length;
    for(var i = 0, arr2 = new Array(len); i < len; i++)arr2[i] = arr[i];
    return arr2;
}
function _array_without_holes(arr) {
    if (Array.isArray(arr)) return _array_like_to_array(arr);
}
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
    try {
        var info = gen[key](arg);
        var value = info.value;
    } catch (error) {
        reject(error);
        return;
    }
    if (info.done) {
        resolve(value);
    } else {
        Promise.resolve(value).then(_next, _throw);
    }
}
function _async_to_generator(fn) {
    return function() {
        var self = this, args = arguments;
        return new Promise(function(resolve, reject) {
            var gen = fn.apply(self, args);
            function _next(value) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
            }
            function _throw(err) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
            }
            _next(undefined);
        });
    };
}
function _class_call_check(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}
function _defineProperties(target, props) {
    for(var i = 0; i < props.length; i++){
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
    }
}
function _create_class(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
}
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _iterable_to_array(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
}
function _non_iterable_spread() {
    throw new TypeError("Invalid attempt to spread non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _to_consumable_array(arr) {
    return _array_without_holes(arr) || _iterable_to_array(arr) || _unsupported_iterable_to_array(arr) || _non_iterable_spread();
}
function _unsupported_iterable_to_array(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _array_like_to_array(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(n);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _array_like_to_array(o, minLen);
}
function _ts_generator(thisArg, body) {
    var f, y, t, g, _ = {
        label: 0,
        sent: function() {
            if (t[0] & 1) throw t[1];
            return t[1];
        },
        trys: [],
        ops: []
    };
    return(g = {
        next: verb(0),
        "throw": verb(1),
        "return": verb(2)
    }, typeof Symbol === "function" && (g[Symbol.iterator] = function() {
        return this;
    }), g);
    function verb(n) {
        return function(v) {
            return step([
                n,
                v
            ]);
        };
    }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while(_)try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [
                op[0] & 2,
                t.value
            ];
            switch(op[0]){
                case 0:
                case 1:
                    t = op;
                    break;
                case 4:
                    _.label++;
                    return {
                        value: op[1],
                        done: false
                    };
                case 5:
                    _.label++;
                    y = op[1];
                    op = [
                        0
                    ];
                    continue;
                case 7:
                    op = _.ops.pop();
                    _.trys.pop();
                    continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                        _ = 0;
                        continue;
                    }
                    if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                        _.label = op[1];
                        break;
                    }
                    if (op[0] === 6 && _.label < t[1]) {
                        _.label = t[1];
                        t = op;
                        break;
                    }
                    if (t && _.label < t[2]) {
                        _.label = t[2];
                        _.ops.push(op);
                        break;
                    }
                    if (t[2]) _.ops.pop();
                    _.trys.pop();
                    continue;
            }
            op = body.call(thisArg, _);
        } catch (e) {
            op = [
                6,
                e
            ];
            y = 0;
        } finally{
            f = t = 0;
        }
        if (op[0] & 5) throw op[1];
        return {
            value: op[0] ? op[1] : void 0,
            done: true
        };
    }
}
var COMPRESSION_LEVEL;
(function(COMPRESSION_LEVEL) {
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["uncompressed"] = 0] = "uncompressed";
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["medium"] = 5] = "medium";
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["high"] = 9] = "high";
})(COMPRESSION_LEVEL || (COMPRESSION_LEVEL = {}));
var ZipAFolder = /*#__PURE__*/ function() {
    function ZipAFolder() {
        _class_call_check(this, ZipAFolder);
    }
    _create_class(ZipAFolder, null, [
        {
            key: "tar",
            value: /**
     * Tars a given folder or a glob into a gzipped tar archive.
     * If no zipAFolderOptions are passed in, the default compression level is high.
     * @param src can be a string path or a glob
     * @param tarFilePath path to the zip file
     * @param zipAFolderOptions
     */ function tar(src, tarFilePath, zipAFolderOptions) {
                return _async_to_generator(function() {
                    var o;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                o = zipAFolderOptions || {
                                    compression: COMPRESSION_LEVEL.high
                                };
                                if (!(o.compression === COMPRESSION_LEVEL.uncompressed)) return [
                                    3,
                                    2
                                ];
                                return [
                                    4,
                                    ZipAFolder.compress({
                                        src: src,
                                        targetFilePath: tarFilePath,
                                        format: "tar",
                                        zipAFolderOptions: zipAFolderOptions
                                    })
                                ];
                            case 1:
                                _state.sent();
                                return [
                                    3,
                                    4
                                ];
                            case 2:
                                return [
                                    4,
                                    ZipAFolder.compress({
                                        src: src,
                                        targetFilePath: tarFilePath,
                                        format: "tar",
                                        zipAFolderOptions: zipAFolderOptions,
                                        archiverOptions: {
                                            gzip: true,
                                            gzipOptions: {
                                                level: o.compression
                                            }
                                        }
                                    })
                                ];
                            case 3:
                                _state.sent();
                                _state.label = 4;
                            case 4:
                                return [
                                    2
                                ];
                        }
                    });
                })();
            }
        },
        {
            key: "zip",
            value: /**
     * Zips a given folder or a glob into a zip archive.
     * If no zipAFolderOptions are passed in, the default compression level is high.
     * @param src can be a string path or a glob
     * @param zipFilePath path to the zip file
     * @param zipAFolderOptions
     */ function zip(src, zipFilePath, zipAFolderOptions) {
                return _async_to_generator(function() {
                    var o;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                o = zipAFolderOptions || {
                                    compression: COMPRESSION_LEVEL.high
                                };
                                if (!(o.compression === COMPRESSION_LEVEL.uncompressed)) return [
                                    3,
                                    2
                                ];
                                return [
                                    4,
                                    ZipAFolder.compress({
                                        src: src,
                                        targetFilePath: zipFilePath,
                                        format: "zip",
                                        zipAFolderOptions: zipAFolderOptions,
                                        archiverOptions: {
                                            store: true
                                        }
                                    })
                                ];
                            case 1:
                                _state.sent();
                                return [
                                    3,
                                    4
                                ];
                            case 2:
                                return [
                                    4,
                                    ZipAFolder.compress({
                                        src: src,
                                        targetFilePath: zipFilePath,
                                        format: "zip",
                                        zipAFolderOptions: zipAFolderOptions,
                                        archiverOptions: {
                                            zlib: {
                                                level: o.compression
                                            }
                                        }
                                    })
                                ];
                            case 3:
                                _state.sent();
                                _state.label = 4;
                            case 4:
                                return [
                                    2
                                ];
                        }
                    });
                })();
            }
        },
        {
            key: "compress",
            value: function compress(param) {
                var src = param.src, targetFilePath = param.targetFilePath, format = param.format, zipAFolderOptions = param.zipAFolderOptions, archiverOptions = param.archiverOptions;
                return _async_to_generator(function() {
                    var _zipAFolderOptions, output, globList, targetBasePath, e, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, globPart, _globList, _, _1, _tmp, err, _zipAFolderOptions1, zipArchive;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                globList = [];
                                if (!(!((_zipAFolderOptions = zipAFolderOptions) === null || _zipAFolderOptions === void 0 ? void 0 : _zipAFolderOptions.customWriteStream) && targetFilePath)) return [
                                    3,
                                    16
                                ];
                                targetBasePath = _path.default.dirname(targetFilePath);
                                if (targetBasePath === src) {
                                    throw new Error("Source and target folder must be different.");
                                }
                                _state.label = 1;
                            case 1:
                                _state.trys.push([
                                    1,
                                    5,
                                    ,
                                    6
                                ]);
                                if (!!(0, _isglob.default)(src)) return [
                                    3,
                                    3
                                ];
                                return [
                                    4,
                                    _fs.default.promises.access(src, _fs.default.constants.R_OK)
                                ];
                            case 2:
                                _state.sent(); //eslint-disable-line no-bitwise
                                _state.label = 3;
                            case 3:
                                return [
                                    4,
                                    _fs.default.promises.access(targetBasePath, _fs.default.constants.R_OK | _fs.default.constants.W_OK)
                                ];
                            case 4:
                                _state.sent(); //eslint-disable-line no-bitwise
                                return [
                                    3,
                                    6
                                ];
                            case 5:
                                e = _state.sent();
                                throw new Error("Permission error: ".concat(e.message));
                            case 6:
                                if (!(0, _isglob.default)(src)) return [
                                    3,
                                    15
                                ];
                                _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                                _state.label = 7;
                            case 7:
                                _state.trys.push([
                                    7,
                                    12,
                                    13,
                                    14
                                ]);
                                _iterator = src.split(",")[Symbol.iterator]();
                                _state.label = 8;
                            case 8:
                                if (!!(_iteratorNormalCompletion = (_step = _iterator.next()).done)) return [
                                    3,
                                    11
                                ];
                                globPart = _step.value;
                                _1 = (_ = (_globList = globList).push).apply;
                                _tmp = [
                                    _globList
                                ];
                                return [
                                    4,
                                    (0, _glob.glob)(globPart.trim())
                                ];
                            case 9:
                                _1.apply(_, _tmp.concat([
                                    _to_consumable_array.apply(void 0, [
                                        _state.sent()
                                    ])
                                ]));
                                _state.label = 10;
                            case 10:
                                _iteratorNormalCompletion = true;
                                return [
                                    3,
                                    8
                                ];
                            case 11:
                                return [
                                    3,
                                    14
                                ];
                            case 12:
                                err = _state.sent();
                                _didIteratorError = true;
                                _iteratorError = err;
                                return [
                                    3,
                                    14
                                ];
                            case 13:
                                try {
                                    if (!_iteratorNormalCompletion && _iterator.return != null) {
                                        _iterator.return();
                                    }
                                } finally{
                                    if (_didIteratorError) {
                                        throw _iteratorError;
                                    }
                                }
                                return [
                                    7
                                ];
                            case 14:
                                if (globList.length === 0) {
                                    throw new Error('No glob match found for "'.concat(src, '".'));
                                }
                                _state.label = 15;
                            case 15:
                                output = _fs.default.createWriteStream(targetFilePath);
                                return [
                                    3,
                                    17
                                ];
                            case 16:
                                if (zipAFolderOptions && zipAFolderOptions.customWriteStream) {
                                    ;
                                    output = (_zipAFolderOptions1 = zipAFolderOptions) === null || _zipAFolderOptions1 === void 0 ? void 0 : _zipAFolderOptions1.customWriteStream;
                                } else {
                                    throw new Error("You must either provide a target file path or a custom write stream to write to.");
                                }
                                _state.label = 17;
                            case 17:
                                zipArchive = (0, _archiver.default)(format, archiverOptions || {});
                                return [
                                    2,
                                    new Promise(function() {
                                        var _ref = _async_to_generator(function(resolve, reject) {
                                            var _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, file, content, err, _zipAFolderOptions;
                                            return _ts_generator(this, function(_state) {
                                                switch(_state.label){
                                                    case 0:
                                                        output.on("close", resolve);
                                                        output.on("error", reject);
                                                        zipArchive.pipe(output);
                                                        if (!(0, _isglob.default)(src)) return [
                                                            3,
                                                            9
                                                        ];
                                                        _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                                                        _state.label = 1;
                                                    case 1:
                                                        _state.trys.push([
                                                            1,
                                                            6,
                                                            7,
                                                            8
                                                        ]);
                                                        _iterator = globList[Symbol.iterator]();
                                                        _state.label = 2;
                                                    case 2:
                                                        if (!!(_iteratorNormalCompletion = (_step = _iterator.next()).done)) return [
                                                            3,
                                                            5
                                                        ];
                                                        file = _step.value;
                                                        return [
                                                            4,
                                                            _fs.default.promises.readFile(file)
                                                        ];
                                                    case 3:
                                                        content = _state.sent();
                                                        zipArchive.append(content, {
                                                            name: file
                                                        });
                                                        _state.label = 4;
                                                    case 4:
                                                        _iteratorNormalCompletion = true;
                                                        return [
                                                            3,
                                                            2
                                                        ];
                                                    case 5:
                                                        return [
                                                            3,
                                                            8
                                                        ];
                                                    case 6:
                                                        err = _state.sent();
                                                        _didIteratorError = true;
                                                        _iteratorError = err;
                                                        return [
                                                            3,
                                                            8
                                                        ];
                                                    case 7:
                                                        try {
                                                            if (!_iteratorNormalCompletion && _iterator.return != null) {
                                                                _iterator.return();
                                                            }
                                                        } finally{
                                                            if (_didIteratorError) {
                                                                throw _iteratorError;
                                                            }
                                                        }
                                                        return [
                                                            7
                                                        ];
                                                    case 8:
                                                        return [
                                                            3,
                                                            10
                                                        ];
                                                    case 9:
                                                        zipArchive.directory(src, ((_zipAFolderOptions = zipAFolderOptions) === null || _zipAFolderOptions === void 0 ? void 0 : _zipAFolderOptions.destPath) || false);
                                                        _state.label = 10;
                                                    case 10:
                                                        zipArchive.finalize();
                                                        return [
                                                            2
                                                        ];
                                                }
                                            });
                                        });
                                        return function(resolve, reject) {
                                            return _ref.apply(this, arguments);
                                        };
                                    }())
                                ];
                        }
                    });
                })();
            }
        }
    ]);
    return ZipAFolder;
}();
var zip = ZipAFolder.zip;
var tar = ZipAFolder.tar;

//# sourceMappingURL=ZipAFolder.js.map