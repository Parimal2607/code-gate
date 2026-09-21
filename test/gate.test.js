'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { runGate } = require('../dist/core/runner');
const { git, initRepo, makeDir, write, writeJson } = require('./helpers');

function resultFor(outcome, id) {
    const found = outcome.results.find((item) => item.id === id);
    assert.ok(found, `expected a result for "${id}"`);
    return found;
}

function commitAll(dir, message) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', message]);
}

test('JavaScript project: TypeScript check is skipped, not failed', async () => {
    const dir = initRepo(makeDir('gate-js'));
    writeJson(dir, 'package.json', { name: 'js-app' });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');
    write(dir, 'src/index.js', 'module.exports = 2;\n');

    const outcome = await runGate({ cwd: dir });
    const typescript = resultFor(outcome, 'typescript');

    assert.equal(outcome.project.language, 'javascript');
    assert.equal(typescript.status, 'skip');
    assert.match(typescript.message, /Not applicable/);
    assert.equal(outcome.exitCode, 0);
});

test('TypeScript project: tsc runs and clean code passes', async () => {
    const dir = initRepo(makeDir('gate-ts-ok'));
    writeJson(dir, 'package.json', { name: 'ts-app' });
    writeJson(dir, 'tsconfig.json', {
        compilerOptions: { target: 'ES2022', strict: true, noEmit: true, skipLibCheck: true },
        include: ['src'],
    });
    write(dir, 'src/index.ts', 'export const add = (a: number, b: number): number => a + b;\n');
    commitAll(dir, 'init');

    const outcome = await runGate({ cwd: dir, all: true });
    const typescript = resultFor(outcome, 'typescript');

    assert.equal(outcome.project.language, 'typescript');
    assert.equal(typescript.status, 'pass', typescript.output);
    assert.equal(outcome.exitCode, 0);
});

test('TypeScript project: a type error fails the gate with exit code 1', async () => {
    const dir = initRepo(makeDir('gate-ts-bad'));
    writeJson(dir, 'package.json', { name: 'ts-app' });
    writeJson(dir, 'tsconfig.json', {
        compilerOptions: { target: 'ES2022', strict: true, noEmit: true, skipLibCheck: true },
        include: ['src'],
    });
    write(dir, 'src/index.ts', 'export const value: number = "not a number";\n');
    commitAll(dir, 'init');

    const outcome = await runGate({ cwd: dir, all: true });
    const typescript = resultFor(outcome, 'typescript');

    assert.equal(typescript.status, 'fail');
    assert.match(typescript.output, /TS2322/);
    assert.equal(outcome.passed, false);
    assert.equal(outcome.exitCode, 1);
});

test('composite tsconfig still type checks', async () => {
    const dir = initRepo(makeDir('gate-ts-composite'));
    writeJson(dir, 'package.json', { name: 'ts-app' });
    writeJson(dir, 'tsconfig.json', {
        compilerOptions: { target: 'ES2022', strict: true, composite: true, skipLibCheck: true, outDir: 'build' },
        include: ['src'],
    });
    write(dir, 'src/index.ts', 'export const value: number = "nope";\n');
    commitAll(dir, 'init');

    const outcome = await runGate({ cwd: dir, all: true });
    const typescript = resultFor(outcome, 'typescript');

    assert.equal(typescript.status, 'fail');
    assert.match(typescript.output, /TS2322/);
});

test('a failing test script blocks the push', async () => {
    const dir = initRepo(makeDir('gate-tests-fail'));
    writeJson(dir, 'package.json', { name: 'app', scripts: { test: 'node -e "process.exit(3)"' } });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');

    const outcome = await runGate({ cwd: dir, all: true });

    assert.equal(resultFor(outcome, 'tests').status, 'fail');
    assert.equal(outcome.exitCode, 1);
});

test('a passing test script allows the push', async () => {
    const dir = initRepo(makeDir('gate-tests-pass'));
    writeJson(dir, 'package.json', { name: 'app', scripts: { test: 'node -e "process.exit(0)"' } });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');

    const outcome = await runGate({ cwd: dir, all: true });

    assert.equal(resultFor(outcome, 'tests').status, 'pass');
    assert.equal(outcome.exitCode, 0);
});

test('missing test and build scripts do not block by default', async () => {
    const dir = initRepo(makeDir('gate-no-scripts'));
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');

    const outcome = await runGate({ cwd: dir, all: true });

    assert.equal(resultFor(outcome, 'tests').status, 'skip');
    assert.equal(resultFor(outcome, 'build').status, 'skip');
    assert.equal(outcome.exitCode, 0);
});

test('requireTests turns a missing test script into a failure', async () => {
    const dir = initRepo(makeDir('gate-require-tests'));
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');

    const outcome = await runGate({ cwd: dir, all: true, configOverrides: { requireTests: true } });

    assert.equal(resultFor(outcome, 'tests').status, 'fail');
    assert.equal(outcome.exitCode, 1);
});

test('checks disabled in .code-gate.json are not run', async () => {
    const dir = initRepo(makeDir('gate-config-off'));
    writeJson(dir, 'package.json', { name: 'app', scripts: { test: 'node -e "process.exit(3)"' } });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    writeJson(dir, '.code-gate.json', { checks: { tests: false } });
    commitAll(dir, 'init');

    const outcome = await runGate({ cwd: dir, all: true });

    assert.equal(
        outcome.results.find((item) => item.id === 'tests'),
        undefined
    );
    assert.equal(outcome.exitCode, 0);
});

test('--skip removes a check from the run', async () => {
    const dir = initRepo(makeDir('gate-skip'));
    writeJson(dir, 'package.json', { name: 'app', scripts: { test: 'node -e "process.exit(3)"' } });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');

    const failing = await runGate({ cwd: dir, all: true });
    assert.equal(failing.exitCode, 1);

    const skipped = await runGate({ cwd: dir, all: true, skip: ['tests'] });
    assert.equal(skipped.exitCode, 0);
});

test('--only runs a single check', async () => {
    const dir = initRepo(makeDir('gate-only'));
    writeJson(dir, 'package.json', { name: 'app', scripts: { test: 'node -e "process.exit(0)"' } });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');

    const outcome = await runGate({ cwd: dir, all: true, only: ['tests'] });

    assert.equal(outcome.results.length, 1);
    assert.equal(outcome.results[0].id, 'tests');
});

test('pre-push mode checks only the files in the pushed range', async () => {
    const dir = initRepo(makeDir('gate-range'));
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'src/old.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');
    const base = git(dir, ['rev-parse', 'HEAD']).stdout.trim();

    write(dir, 'src/new.js', 'module.exports = 2;\n');
    commitAll(dir, 'second');
    const head = git(dir, ['rev-parse', 'HEAD']).stdout.trim();

    const stdin = `refs/heads/main ${head} refs/heads/main ${base}\n`;
    const outcome = await runGate({ cwd: dir, hook: 'pre-push', stdin, remoteName: 'origin' });

    assert.deepEqual(outcome.selection.files, ['src/new.js']);
    assert.equal(outcome.selection.isFullScan, false);
});

test('pre-push mode ignores branch deletions', async () => {
    const dir = initRepo(makeDir('gate-delete'));
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');

    const zeros = '0'.repeat(40);
    const stdin = `(delete) ${zeros} refs/heads/gone ${'a'.repeat(40)}\n`;
    const outcome = await runGate({ cwd: dir, hook: 'pre-push', stdin, remoteName: 'origin' });

    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.selection.files.length, 0);
});

test('a brand new branch falls back to the full history of new commits', async () => {
    const dir = initRepo(makeDir('gate-new-branch'));
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');
    const head = git(dir, ['rev-parse', 'HEAD']).stdout.trim();

    const zeros = '0'.repeat(40);
    const stdin = `refs/heads/main ${head} refs/heads/main ${zeros}\n`;
    const outcome = await runGate({ cwd: dir, hook: 'pre-push', stdin, remoteName: 'origin' });

    assert.ok(outcome.selection.files.includes('src/index.js'));
    assert.ok(outcome.selection.files.includes('package.json'));
});

test('a crashing check fails closed instead of allowing the push', async () => {
    const dir = initRepo(makeDir('gate-crash'));
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    commitAll(dir, 'init');

    const { checks } = require('../dist/checks');
    const exploding = {
        id: 'prettier',
        name: 'Exploding',
        run() {
            throw new Error('boom');
        },
    };
    const original = checks.slice();
    checks.length = 0;
    checks.push(exploding);

    try {
        const outcome = await runGate({ cwd: dir, all: true });
        assert.equal(outcome.results[0].status, 'fail');
        assert.match(outcome.results[0].output, /boom/);
        assert.equal(outcome.exitCode, 1);
    } finally {
        checks.length = 0;
        checks.push(...original);
    }
});
