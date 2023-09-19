cat >dist/lib/cjs/package.json <<!EOF
{
    "type": "commonjs"
}
!EOF

cat >dist/lib/mjs/package.json <<!EOF
{
    "type": "module"
}
!EOF

mv dist/lib/mjs/index.js dist/lib/mjs/index.mjs
mv dist/lib/mjs/ZipAFolder.js dist/lib/mjs/ZipAFolder.mjs