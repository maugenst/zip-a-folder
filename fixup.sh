#!/bin/sh

cat >dist/lib/cjs/package.json <<!EOF
{
    "type": "commonjs"
}
!EOF
cd dist
find . -name "*.d.ts" -type f -exec cp {} ../@typings/ \;
cd ..

cat >dist/lib/mjs/package.json <<!EOF
{
    "type": "module"
}
!EOF
mv dist/lib/mjs/ZipAFolder.d.ts @typings
npx @biomejs/biome lint ./@typings --write
