'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { diffLines, renderHunks, normalizeEol, splitLines } = require('../dist/core/diff');
const { parseCheckOutput } = require('../dist/checks/prettierReport');

test('identical content produces no hunks', () => {
    assert.deepEqual(diffLines(['a', 'b'], ['a', 'b']), []);
});

test('a single changed line is reported with its line number', () => {
    const original = ['one', 'two', 'three'];
    const formatted = ['one', 'TWO', 'three'];

    const hunks = diffLines(original, formatted);

    assert.equal(hunks.length, 1);
    assert.equal(hunks[0].line, 2);
    assert.deepEqual(hunks[0].removed, ['two']);
    assert.deepEqual(hunks[0].added, ['TWO']);
});

test('line numbers are correct deep inside a file', () => {
    const original = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const formatted = original.slice();
    formatted[41] = 'CHANGED';

    const hunks = diffLines(original, formatted);

    assert.equal(hunks.length, 1);
    assert.equal(hunks[0].line, 42);
});

test('insertions are reported at the right position', () => {
    const hunks = diffLines(['a', 'c'], ['a', 'b', 'c']);

    assert.equal(hunks.length, 1);
    assert.equal(hunks[0].line, 2);
    assert.deepEqual(hunks[0].removed, []);
    assert.deepEqual(hunks[0].added, ['b']);
});

test('deletions are reported', () => {
    const hunks = diffLines(['a', 'b', 'c'], ['a', 'c']);

    assert.equal(hunks.length, 1);
    assert.equal(hunks[0].line, 2);
    assert.deepEqual(hunks[0].removed, ['b']);
});

test('multiple separate changes become multiple hunks', () => {
    const original = ['a', 'x', 'c', 'd', 'y', 'f'];
    const formatted = ['a', 'X', 'c', 'd', 'Y', 'f'];

    const hunks = diffLines(original, formatted);

    assert.equal(hunks.length, 2);
    assert.equal(hunks[0].line, 2);
    assert.equal(hunks[1].line, 5);
});

test('the real world case: sloppy JSX gets exact line numbers', () => {
    const onDisk = ['export function Card() {', '    return (', '<div   className="a"   >', '<span>hi</span>', '    </div>', '    );', '}'];
    const expected = [
        'export function Card() {',
        '    return (',
        '        <div className="a">',
        '            <span>hi</span>',
        '        </div>',
        '    );',
        '}',
    ];

    const hunks = diffLines(onDisk, expected);
    const rendered = renderHunks(hunks).join('\n');

    assert.equal(hunks[0].line, 3);
    assert.match(rendered, /^\s+3 - <div   className="a"   >/m);
    assert.match(rendered, /\+\s+<div className="a">/);
});

test('rendered output caps long hunks', () => {
    const removed = Array.from({ length: 30 }, (_, i) => `old ${i}`);
    const added = Array.from({ length: 30 }, (_, i) => `new ${i}`);

    const rendered = renderHunks([{ line: 1, removed, added }]).join('\n');

    assert.match(rendered, /more line\(s\)/);
    assert.ok(rendered.split('\n').length < 30);
});

test('a big change falls back to a single hunk instead of stalling', () => {
    const original = Array.from({ length: 4000 }, (_, i) => `a ${i}`);
    const formatted = Array.from({ length: 4000 }, (_, i) => `b ${i}`);

    const started = Date.now();
    const hunks = diffLines(original, formatted);

    assert.equal(hunks.length, 1);
    assert.ok(Date.now() - started < 2000, 'must not stall on large files');
});

test('CRLF normalisation', () => {
    assert.deepEqual(splitLines(normalizeEol('a\r\nb\r\n')), ['a', 'b', '']);
});

test('prettier --check output is parsed into file paths', () => {
    const output = [
        'Checking formatting...',
        '[warn] src/app/page.tsx',
        '[warn] src/components/Card.tsx',
        '[warn] Code style issues found in the above file. Run Prettier with --write to fix.',
    ].join('\n');

    const files = parseCheckOutput(output, ['src/app/page.tsx', 'src/components/Card.tsx', 'src/clean.tsx']);

    assert.deepEqual(files, ['src/app/page.tsx', 'src/components/Card.tsx']);
});

test('the prettier summary line is never mistaken for a file', () => {
    const output = '[warn] Code style issues found in the above file.';
    assert.deepEqual(parseCheckOutput(output, ['a.ts']), []);
});
