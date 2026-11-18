#!/usr/bin/env bash
# Copies the office out of the workspace and typechecks it against the published plugin SDK,
# with nothing of the fork on its path. Exits non-zero on the first type that only the fork has.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/tmp/office-stock-check}"
SDK="${OFFICE_SDK_VERSION:-0.16.2}"
rm -rf "$OUT" && mkdir -p "$OUT"
# The tests lean on the workspace's vitest setup; part 2 gives the new repo its own.
tar -C "$HERE" --exclude node_modules --exclude '*.test.ts' --exclude '*.test.tsx' -cf - . | tar -C "$OUT" -xf -
cd "$OUT"
cat > package.json <<JSON
{
  "name": "paseo-office",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "@getpaseo/plugin": "$SDK", "zod": "^4.4.3" },
  "devDependencies": {
    "@types/node": "^20.9.0",
    "@types/react": "^19.2.0",
    "react": "19.2.3",
    "react-native": "0.86.3",
    "typescript": "^5.9.3"
  }
}
JSON
cat > tsconfig.json <<JSON
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2023", "DOM"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react-jsx"
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "vendor", "scripts"]
}
JSON
npm install --no-audit --no-fund >/dev/null
npx tsc -p tsconfig.json
echo "the office typechecks against @getpaseo/plugin@$SDK"
