default:
    @just --list

install:
    pnpm install --frozen-lockfile

lint:
    pnpm biome lint .

fix:
    pnpm biome format --write .
    pnpm biome lint --write .

typecheck:
    pnpm tsc --noEmit

test:
    pnpm vitest run

check: lint typecheck test

clean:
    rm -rf dist *.tsbuildinfo

fresh: clean install check
