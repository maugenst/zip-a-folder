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
    ZipAFolder: function() {
        return _ZipAFolder.ZipAFolder;
    },
    zip: function() {
        return zip;
    },
    tar: function() {
        return tar;
    }
});
var _ZipAFolder = require("./ZipAFolder");
var zip = _ZipAFolder.ZipAFolder.zip;
var tar = _ZipAFolder.ZipAFolder.tar;

//# sourceMappingURL=index.js.map