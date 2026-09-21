'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parsePrePushStdin, getWorkingChanges } = require('../dist/git/git');
const { installPrePushHook, uninstallPrePushHook, readInstalledHook, hookPathFor } = require('../dist/hook/install');
const { HOOK_MARKER } = require('../dist/hook/template');
const { applyIgnore, chunkFiles, filterByExtension, findScript } = require('../dist/checks/helpers');
const { git, initRepo, makeDir, makeExternalDir, write, writeJson } = require('./helpers');

test('pre-push stdin lines are parsed into refs', () => {
    const input = [
        'refs/heads/main aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'refs/heads/dev cccccccccccccccccccccccccccccccccccccccc refs/heads/dev 0000000000000000000000000000000000000000',
        '',
        'garbage line',
    ].join('\n');

    const refs = parsePrePushStdin(input);

    assert.equal(refs.length, 2);
    assert.equal(refs[0].localRef, 'refs/heads/main');
    assert.equal(refs[0].remoteSha, 'b'.repeat(40));
    assert.equal(refs[1].remoteSha, '0'.repeat(40));
});

test('empty stdin yields no refs', () => {
    assert.deepEqual(parsePrePushStdin(''), []);
    assert.deepEqual(parsePrePushStdin('\n\n'), []);
});

test('working changes include staged, unstaged and untracked files', () => {
    const dir = initRepo(makeDir('git-changes'));
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'a.js', 'module.exports = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'init']);

    write(dir, 'a.js', 'module.exports = 2;\n');
    write(dir, 'b.js', 'module.exports = 3;\n');

    const changes = getWorkingChanges(dir);

    assert.ok(changes.files.includes('a.js'), 'modified file is included');
    assert.ok(changes.files.includes('b.js'), 'untracked file is included');
});

test('installing the pre-push hook creates an executable sh script', () => {
    const dir = initRepo(makeDir('hook-install'));

    const result = installPrePushHook(dir);

    assert.equal(result.action, 'created');
    const contents = fs.readFileSync(result.hookPath, 'utf8');
    assert.match(contents, /^#!\/bin\/sh/);
    assert.ok(contents.includes(HOOK_MARKER));
    assert.ok(contents.includes('--hook pre-push'));
    assert.ok(!contents.includes('\r\n'), 'hook must use LF line endings');
    assert.equal(path.basename(result.hookPath), 'pre-push');
});

test('re-running init is idempotent', () => {
    const dir = initRepo(makeDir('hook-idempotent'));

    installPrePushHook(dir);
    assert.equal(installPrePushHook(dir).action, 'unchanged');
});

test('an outdated code-gate hook is updated in place', () => {
    const dir = initRepo(makeDir('hook-update'));
    const hookPath = hookPathFor(dir);
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, `#!/bin/sh\n${HOOK_MARKER}\n# hook-version: 0\nexec code-gate\n`, 'utf8');

    assert.equal(installPrePushHook(dir).action, 'updated');
});

test('an unrelated hook is preserved unless --force is used', () => {
    const dir = initRepo(makeDir('hook-foreign'));
    const hookPath = hookPathFor(dir);
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, '#!/bin/sh\necho custom hook\n', 'utf8');

    const blocked = installPrePushHook(dir);
    assert.equal(blocked.action, 'blocked');
    assert.equal(fs.readFileSync(hookPath, 'utf8'), '#!/bin/sh\necho custom hook\n');

    const forced = installPrePushHook(dir, { force: true });
    assert.equal(forced.action, 'replaced');
    assert.ok(fs.existsSync(forced.backupPath));
    assert.equal(fs.readFileSync(forced.backupPath, 'utf8'), '#!/bin/sh\necho custom hook\n');
});

test('core.hooksPath is respected', () => {
    const dir = initRepo(makeDir('hook-custom-path'));
    fs.mkdirSync(path.join(dir, '.husky'), { recursive: true });
    git(dir, ['config', 'core.hooksPath', '.husky']);

    const result = installPrePushHook(dir);

    assert.equal(result.action, 'created');
    assert.equal(path.resolve(result.hookPath), path.resolve(path.join(dir, '.husky', 'pre-push')));
});

test('uninstall removes only hooks we manage', () => {
    const dir = initRepo(makeDir('hook-uninstall'));
    installPrePushHook(dir);

    assert.equal(readInstalledHook(dir).managed, true);
    assert.equal(uninstallPrePushHook(dir).removed, true);
    assert.equal(readInstalledHook(dir).exists, false);

    const hookPath = hookPathFor(dir);
    fs.writeFileSync(hookPath, '#!/bin/sh\necho other\n', 'utf8');
    const refused = uninstallPrePushHook(dir);
    assert.equal(refused.removed, false);
    assert.ok(fs.existsSync(hookPath));
});

test('installing outside a git repository is reported, not crashed', () => {
    // Deliberately outside this repo: a non-repo fixture inside it would
    // resolve upwards and write into code-gate's own .git/hooks.
    const dir = makeExternalDir('hook-no-repo');

    assert.equal(hookPathFor(dir), undefined, 'must not resolve a hooks dir outside a repo');
    assert.equal(installPrePushHook(dir).action, 'blocked');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('files are filtered by extension', () => {
    const files = ['a.js', 'b.ts', 'c.md', 'd.png', 'e.tsx'];
    assert.deepEqual(filterByExtension(files, ['.js', '.ts', '.tsx']), ['a.js', 'b.ts', 'e.tsx']);
});

test('ignore patterns support globs', () => {
    const files = ['src/a.js', 'src/nested/b.js', 'generated/c.js'];
    assert.deepEqual(applyIgnore(files, ['generated/*']), ['src/a.js', 'src/nested/b.js']);
    assert.deepEqual(applyIgnore(files, ['src/**']), ['generated/c.js']);
    assert.deepEqual(applyIgnore(files, []), files);
});

test('long file lists are chunked', () => {
    const files = Array.from({ length: 400 }, (_, index) => `src/file-${index}.ts`);
    const chunks = chunkFiles(files);

    assert.ok(chunks.length > 1);
    assert.equal(chunks.flat().length, files.length);
    for (const chunk of chunks) {
        assert.ok(chunk.join(' ').length <= 6000);
    }
});

test("npm's placeholder test script is ignored", () => {
    const placeholder = { scripts: { test: 'echo "Error: no test specified" && exit 1' } };
    assert.equal(findScript({ scripts: placeholder.scripts }, ['test']), undefined);
    assert.deepEqual(findScript({ scripts: { test: 'vitest run' } }, ['test']), { name: 'test', value: 'vitest run' });
});
