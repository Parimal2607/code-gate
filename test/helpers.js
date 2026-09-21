'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

/**
 * Fixtures live under <repo>/tmp so that module resolution walks up into the
 * repo's own node_modules. That gives the TypeScript check a real `tsc` to run
 * without installing anything per fixture.
 */
const sandboxRoot = path.join(repoRoot, 'tmp', 'test-sandbox');

function makeDir(prefix) {
    fs.mkdirSync(sandboxRoot, { recursive: true });
    return fs.mkdtempSync(path.join(sandboxRoot, `${prefix}-`));
}

function write(dir, relativePath, contents) {
    const target = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf8');
    return target;
}

function writeJson(dir, relativePath, value) {
    return write(dir, relativePath, `${JSON.stringify(value, null, 4)}\n`);
}

function git(dir, args) {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
    return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function initRepo(dir) {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    return dir;
}

function cleanupSandbox() {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
}

module.exports = { repoRoot, sandboxRoot, makeDir, write, writeJson, git, initRepo, cleanupSandbox, os };
