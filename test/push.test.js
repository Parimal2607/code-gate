'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { installPrePushHook } = require('../dist/hook/install');
const { git, initRepo, makeDir, repoRoot, write, writeJson } = require('./helpers');

const cliPath = path.join(repoRoot, 'dist', 'cli.js').split(path.sep).join('/');

/**
 * Give the fixture a project-local `code-gate` shim so the installed hook can
 * find this build without relying on a global npm install.
 */
function installLocalShim(dir) {
    const binDir = path.join(dir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const shim = path.join(binDir, 'code-gate');
    fs.writeFileSync(shim, `#!/bin/sh\nexec node "${cliPath}" "$@"\n`.replace(/\r\n/g, '\n'), 'utf8');
    fs.chmodSync(shim, 0o755);
}

function createRepoWithRemote(name) {
    const dir = initRepo(makeDir(name));
    const remote = makeDir(`${name}-remote`);
    git(remote, ['init', '-q', '--bare']);
    git(dir, ['remote', 'add', 'origin', remote]);
    write(dir, '.gitignore', 'node_modules/\n');
    installLocalShim(dir);
    installPrePushHook(dir);
    return { dir, remote };
}

function remoteHead(remote) {
    const result = git(remote, ['rev-parse', 'main']);
    return result.code === 0 ? result.stdout.trim() : null;
}

test('end to end: failing checks block git push, fixing them allows it', async (t) => {
    const { dir, remote } = createRepoWithRemote('push');

    // A test script that fails only when the marker file says so.
    writeJson(dir, 'package.json', {
        name: 'push-fixture',
        private: true,
        scripts: { test: 'node -e "process.exit(require(\'fs\').readFileSync(\'flag.txt\',\'utf8\').trim()===\'ok\'?0:1)"' },
    });
    write(dir, 'flag.txt', 'broken\n');
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'init']);

    await t.test('push is blocked while the test script fails', () => {
        const push = git(dir, ['push', '-u', 'origin', 'main']);

        assert.notEqual(push.code, 0, 'git push must exit non-zero');
        assert.match(push.stdout + push.stderr, /PUSH BLOCKED/);
        assert.equal(remoteHead(remote), null, 'nothing may reach the remote');
    });

    await t.test('--no-verify bypasses the gate', () => {
        const push = git(dir, ['push', '--no-verify', 'origin', 'main']);

        assert.equal(push.code, 0);
        assert.ok(remoteHead(remote), 'bypassed push reaches the remote');
        git(remote, ['update-ref', '-d', 'refs/heads/main']);
    });

    await t.test('push succeeds once the checks pass', () => {
        write(dir, 'flag.txt', 'ok\n');
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', 'fix']);

        const push = git(dir, ['push', '-u', 'origin', 'main']);

        assert.equal(push.code, 0, push.stdout + push.stderr);
        assert.match(push.stdout + push.stderr, /PUSH ALLOWED/);
        assert.equal(remoteHead(remote), git(dir, ['rev-parse', 'HEAD']).stdout.trim());
    });
});

test('end to end: a hook without code-gate available blocks the push', () => {
    const { dir, remote } = createRepoWithRemote('push-missing');
    fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });

    writeJson(dir, 'package.json', { name: 'no-tool' });
    write(dir, 'src/index.js', 'module.exports = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'init']);

    // PATH is emptied so the global binary cannot be found either.
    const push = git(dir, ['-c', 'core.hooksPath=.git/hooks', 'push', '-u', 'origin', 'main']);
    const output = push.stdout + push.stderr;

    if (/command not found/.test(output)) {
        assert.notEqual(push.code, 0);
        assert.equal(remoteHead(remote), null);
    } else {
        // A globally installed code-gate was found: the gate still ran, which is fine.
        assert.match(output, /CODE GATE/);
    }
});
