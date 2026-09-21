'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { detectProject } = require('../dist/detect/project');
const { detectPackageManager } = require('../dist/detect/packageManager');
const { loadConfig } = require('../dist/detect/config');
const { makeDir, write, writeJson } = require('./helpers');

test('a project with only .js files is detected as JavaScript', () => {
    const dir = makeDir('js');
    writeJson(dir, 'package.json', { name: 'js-app', scripts: { test: 'node --test' } });
    write(dir, 'src/index.js', 'module.exports = 1;\n');

    const project = detectProject(dir);

    assert.equal(project.language, 'javascript');
    assert.equal(project.tsconfigPath, undefined);
});

test('a project with tsconfig.json is detected as TypeScript', () => {
    const dir = makeDir('ts');
    writeJson(dir, 'package.json', { name: 'ts-app' });
    writeJson(dir, 'tsconfig.json', { compilerOptions: { strict: true } });
    write(dir, 'src/index.ts', 'export const x: number = 1;\n');

    const project = detectProject(dir);

    assert.equal(project.language, 'typescript');
    assert.equal(path.basename(project.tsconfigPath), 'tsconfig.json');
});

test('.ts files alone are enough to detect TypeScript', () => {
    const dir = makeDir('ts-no-config');
    writeJson(dir, 'package.json', { name: 'ts-app' });
    write(dir, 'src/index.ts', 'export const x: number = 1;\n');

    assert.equal(detectProject(dir).language, 'typescript');
});

test('typescript as a dependency does not make a JS project TypeScript', () => {
    const dir = makeDir('js-with-ts-dep');
    writeJson(dir, 'package.json', { name: 'js-app', devDependencies: { typescript: '5.5.4' } });
    write(dir, 'src/index.js', 'module.exports = 1;\n');

    assert.equal(detectProject(dir).language, 'javascript');
});

test('composite tsconfig is flagged so tsc gets the extra flags', () => {
    const dir = makeDir('ts-composite');
    writeJson(dir, 'package.json', { name: 'ts-app' });
    write(dir, 'tsconfig.json', '{\n  // comment\n  "compilerOptions": { "composite": true },\n}\n');

    const project = detectProject(dir);

    assert.equal(project.language, 'typescript');
    assert.equal(project.tsconfigComposite, true);
});

test('frameworks are detected from dependencies', () => {
    const dir = makeDir('next');
    writeJson(dir, 'package.json', { name: 'web', dependencies: { next: '14.0.0', react: '18.3.1' } });
    write(dir, 'src/page.tsx', 'export default function Page() { return null; }\n');

    const project = detectProject(dir);

    assert.equal(project.frameworkLabel, 'Next.js');
    assert.ok(project.frameworks.includes('React'));
    assert.equal(project.language, 'typescript');
});

test('a plain package.json falls back to Node.js', () => {
    const dir = makeDir('node');
    writeJson(dir, 'package.json', { name: 'api' });
    write(dir, 'index.js', 'console.log(1);\n');

    assert.equal(detectProject(dir).frameworkLabel, 'Node.js');
});

test('config file discovery finds prettier and eslint configs', () => {
    const dir = makeDir('configs');
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'index.js', 'module.exports = 1;\n');
    write(dir, '.prettierrc', '{ "singleQuote": true }\n');
    write(dir, 'eslint.config.mjs', 'export default [];\n');

    const project = detectProject(dir);

    assert.equal(path.basename(project.tools.prettier.configPath), '.prettierrc');
    assert.equal(path.basename(project.tools.eslint.configPath), 'eslint.config.mjs');
});

test('configs inside package.json are recognised', () => {
    const dir = makeDir('inline-configs');
    writeJson(dir, 'package.json', { name: 'app', prettier: { semi: false }, eslintConfig: { rules: {} } });
    write(dir, 'index.js', 'module.exports = 1;\n');

    const project = detectProject(dir);

    assert.equal(project.tools.prettier.configInPackageJson, true);
    assert.equal(project.tools.eslint.configInPackageJson, true);
});

test('package manager is detected from lock files', () => {
    const cases = [
        ['package-lock.json', 'npm'],
        ['yarn.lock', 'yarn'],
        ['pnpm-lock.yaml', 'pnpm'],
        ['bun.lock', 'bun'],
        ['bun.lockb', 'bun'],
    ];

    for (const [lockFile, expected] of cases) {
        const dir = makeDir(`pm-${expected}`);
        writeJson(dir, 'package.json', { name: 'app' });
        write(dir, lockFile, '');

        assert.equal(detectPackageManager(dir, {}).manager, expected, `${lockFile} -> ${expected}`);
    }
});

test('the packageManager field wins over lock files', () => {
    const dir = makeDir('pm-field');
    write(dir, 'package-lock.json', '');

    const detection = detectPackageManager(dir, { packageManager: 'pnpm@9.0.0' });

    assert.equal(detection.manager, 'pnpm');
    assert.match(detection.reason, /packageManager/);
});

test('no lock file falls back to npm', () => {
    const dir = makeDir('pm-none');
    writeJson(dir, 'package.json', { name: 'app' });

    assert.equal(detectPackageManager(dir, {}).manager, 'npm');
});

test('config defaults apply when .code-gate.json is absent', () => {
    const dir = makeDir('cfg-default');
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'index.js', 'module.exports = 1;\n');

    const config = loadConfig(detectProject(dir));

    assert.deepEqual(config.checks, { prettier: true, eslint: true, typescript: true, tests: true, build: true });
    assert.equal(config.requireTests, false);
    assert.equal(config.requireBuild, false);
    assert.equal(config.configPath, undefined);
});

test('.code-gate.json disables checks and CLI overrides win', () => {
    const dir = makeDir('cfg-file');
    writeJson(dir, 'package.json', { name: 'app' });
    write(dir, 'index.js', 'module.exports = 1;\n');
    writeJson(dir, '.code-gate.json', { checks: { build: false, tests: false }, requireTests: true });

    const project = detectProject(dir);
    const config = loadConfig(project);

    assert.equal(config.checks.build, false);
    assert.equal(config.checks.tests, false);
    assert.equal(config.checks.prettier, true);
    assert.equal(config.requireTests, true);
    assert.ok(config.configPath);

    const overridden = loadConfig(project, { overrides: { checks: { build: true }, requireTests: false } });
    assert.equal(overridden.checks.build, true);
    assert.equal(overridden.requireTests, false);
});
