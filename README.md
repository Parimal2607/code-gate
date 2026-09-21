# code-gate

A local code quality gate for Git. Before a push leaves your machine, `code-gate` runs the checks your project already has (Prettier, ESLint, TypeScript, tests, build). If every required check passes, the push goes through. If one fails, Git blocks the push.

No AI review, no dashboards, no cloud service, no GitHub API. It is an orchestrator around the tools you already installed.

```text
git push
   -> Git pre-push hook
      -> code-gate
         -> detect project
         -> select applicable checks
         -> run the project's own tools
         -> PASS -> exit 0 -> push allowed
            FAIL -> exit 1 -> push blocked
```

## Install

```bash
npm install -g @prmvx/code-gate
```

The binary is called `code-gate`. Note the scope: the unscoped `code-gate` on npm is a different project.

Then, once per repository:

```bash
cd your-project
code-gate init
```

That installs a `pre-push` hook. From then on `git push` runs the gate automatically.

You can also install it per project, which is what teams usually want, because the hook prefers a local install:

```bash
npm install --save-dev @prmvx/code-gate
npx code-gate init
```

## Usage

```bash
code-gate              # run all applicable checks on changed files
code-gate check        # same thing, explicitly
code-gate check --all  # check every tracked file
code-gate init         # install/refresh the pre-push hook
code-gate doctor       # show what was detected and whether the gate is wired up
code-gate uninstall    # remove the hook
```

### Options

| Option | What it does |
| --- | --- |
| `--all` | Check every tracked file instead of only changed files |
| `--skip <ids>` | Skip checks, comma separated: `prettier,eslint,typescript,tests,build` |
| `--only <ids>` | Run only these checks |
| `--no-tests`, `--no-build` | Shortcuts for `--skip tests` / `--skip build` |
| `--require-tests`, `--require-build` | Fail when the project has no test/build script |
| `--cwd <dir>` | Run as if started in `<dir>` |
| `--verbose`, `-V` | Show detection reasons, timings and the selected file list |
| `--force` | `init`: back up and replace an unrelated existing `pre-push` hook |
| `--config` | `init`: also write a starter `.code-gate.json` |
| `--version`, `--help` | Version / help |

### Example output

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                 CODE GATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Project       Next.js (web)
Language      TypeScript
Package Mgr   pnpm
Files         3 changed

Checks

✓ Prettier    3 file(s) formatted correctly (config: .prettierrc)
✗ ESLint      Lint errors found (config: eslint.config.js)
✓ TypeScript  No type errors (v5.5.4)
- Tests       Not configured (no test script)
✓ Build       `build` script passed

ESLint output:
$ eslint 3 file(s)

  src/components/UserCard.tsx
    42:5  error  'user' is assigned a value but never used  no-unused-vars

Prettier output:
$ prettier --check 3 file(s)

  src/components/Card.tsx
       12 - <div   className="wrapper"   >
          - <span>hello</span>
          + <div className="wrapper">
          +     <span>hello</span>

Fix with: npx prettier --write src/components/Card.tsx

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        ✗ PUSH BLOCKED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Failed: ESLint

Please fix the failed checks and try again.
Bypass in an emergency: git push --no-verify
```

Status markers: `✓` pass, `✗` fail, `⚠` warning (never blocks), `-` not applicable.

### Failure detail

Every failure reports a file and a line number:

- **ESLint** and **TypeScript** already do, so their output is passed through with the project root trimmed off the paths.
- **Prettier** only prints file names, so code-gate re-formats each failing file in memory and diffs it against what is on disk, showing the line number, the current lines (`-`) and what Prettier would write (`+`), plus a ready-to-run `prettier --write` command.
- Differences that a diff cannot show are named explicitly: `line endings: file uses CRLF, Prettier expects LF` and `end of file: missing newline at the end`.

## What gets checked

| Check | Runs when | Command | Scope |
| --- | --- | --- | --- |
| Prettier | `prettier` is installed | `prettier --check <files>` | changed files |
| ESLint | `eslint` is installed **and** a config exists | `eslint <files>` | changed files |
| TypeScript | the project is TypeScript **and** `typescript` is installed | `tsc --noEmit` | whole project |
| Tests | a `test` script exists in package.json | `<pkg manager> run test` | whole project |
| Build | a `build` script exists in package.json | `<pkg manager> run build` | whole project |

Anything that is missing is reported as not applicable and does not block the push. A missing test script or build script is not a failure by default; set `requireTests` / `requireBuild` if you want that.

The gate only blocks on `✗ fail`. If a tool is installed but cannot be executed, the result is a `⚠` warning and the push continues.

## Configuration

Detection is automatic, so no configuration is needed. If you want to override something, add `.code-gate.json` to the project root:

```json
{
    "checks": {
        "prettier": true,
        "eslint": true,
        "typescript": true,
        "tests": true,
        "build": false
    },
    "requireTests": false,
    "requireBuild": false,
    "changedFilesOnly": true,
    "ignore": ["src/generated/**"]
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `checks.*` | all `true` | Turn an individual check off entirely |
| `requireTests` | `false` | Fail when there is no test script |
| `requireBuild` | `false` | Fail when there is no build script |
| `changedFilesOnly` | `true` | `false` sends every tracked file to Prettier/ESLint |
| `ignore` | `[]` | Globs never sent to Prettier/ESLint |

Formatting and lint rules are never configured here. `code-gate` shells out to your tools, which read your own `.prettierrc`, `eslint.config.js`, `tsconfig.json`, including plugins such as `prettier-plugin-tailwindcss`.

## Emergency bypass

```bash
git push --no-verify          # skip all hooks once
CODE_GATE_SKIP=1 git push     # skip only code-gate
```

## How it works

### The pre-push hook

`code-gate init` writes a POSIX `sh` script to the repository's hooks directory. It resolves `core.hooksPath` first (so it cooperates with husky) and `--git-common-dir` (so linked worktrees install into the main repo). The script:

1. exits early when `CODE_GATE_SKIP=1`
2. resolves the CLI in this order: `./node_modules/.bin/code-gate`, then the absolute path recorded when `init` ran, then `code-gate` on `PATH`
3. runs `code-gate check --hook pre-push --remote <remote>`
4. blocks the push with a clear message when none of those exist, since an unverifiable push is not a verified push (set `CODE_GATE_OPTIONAL=1` to downgrade that to a warning)

The recorded absolute path matters because `code-gate` is a common binary name: without it, a different globally installed package with the same binary name can hijack the hook. The recorded path is skipped when the file does not exist, so a committed hook still works on a teammate's machine.

An existing hook written by code-gate is upgraded in place. An unrelated existing hook is left alone unless you pass `--force`, which backs it up to `pre-push.backup` first.

### Exit codes

Git runs the pre-push hook and reads its exit status. The hook `exec`s `code-gate`, so the CLI's exit code becomes the hook's exit code.

| Situation | Exit code | Result |
| --- | --- | --- |
| All required checks passed | `0` | push continues |
| At least one check failed | `1` | push aborted, nothing reaches the remote |
| code-gate crashed | `1` | push aborted (fails closed on purpose) |
| A check threw internally | `1` | reported as a failed check |

### Project detection

`detectProject()` walks up from the working directory to the nearest `package.json`, then collects:

- **language** from `tsconfig.json`, real `.ts`/`.tsx` files, `typescript` in dependencies
- **framework** from dependencies: Next.js, Nuxt, Remix, Angular, Svelte, Vue, React, Vite, NestJS, Express, Fastify, falling back to Node.js
- **package manager** from `packageManager` in package.json, then lock files (`pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `yarn.lock`, `package-lock.json`), searching upwards for monorepos
- **tools** by locating `node_modules/<tool>` upwards, reading the installed version and its `bin` entry
- **configs** for Prettier (`.prettierrc`, `.prettierrc.{json,js,cjs,mjs,ts,yaml,yml}`, `prettier.config.*`, `package.json#prettier`) and ESLint (`eslint.config.{js,mjs,cjs,ts,mts,cts}`, `.eslintrc*`, `package.json#eslintConfig`)

Tools are executed as `node <resolved bin entry>` rather than through `.bin` shims. That guarantees the project's own version runs and avoids shell quoting problems on Windows.

### JavaScript vs TypeScript

A project is TypeScript when it has a `tsconfig.json` **or** at least one real `.ts` / `.tsx` / `.mts` / `.cts` file. Having `typescript` in `devDependencies` alone is not enough, because plenty of JavaScript projects carry it transitively.

- JavaScript project: Prettier, ESLint, tests, build. TypeScript is reported as `- Not applicable (JavaScript project)` and never fails the push.
- TypeScript project: the above plus `tsc --noEmit`, using your `tsconfig.json`. Composite projects get `--composite false --incremental false` so `--noEmit` is accepted.

### Changed files

Prettier and ESLint only see files that are actually being pushed:

- In the hook, Git provides `<local ref> <local sha> <remote ref> <remote sha>` on stdin. code-gate diffs `remote sha..local sha`.
- For a branch that does not exist on the remote yet, it finds the oldest commit not present on any remote and diffs from its parent (or from the empty tree for a root commit), with `origin/HEAD`, `origin/main` and `origin/master` as fallbacks.
- Branch deletions are skipped. If a range genuinely cannot be resolved, it checks everything rather than nothing.
- Run manually, it uses staged + unstaged + untracked changes, falling back to a diff against the upstream branch.

File lists are chunked so command lines stay well under OS limits. TypeScript, tests and build always run at project level.

## Local development

```bash
git clone <your fork>
cd code-gate
npm install
npm run build          # compile src/ -> dist/
npm test               # 49 tests: detection, hook install, gate logic, real git pushes
```

Try it against a real repository without publishing:

```bash
npm link               # exposes `code-gate` globally from your working copy
cd ../some-project
code-gate init
code-gate doctor
code-gate --verbose
git push               # the hook runs your working copy
```

Undo with `npm unlink -g code-gate`. Alternatively use `npm pack` and install the resulting tarball:

```bash
npm pack
npm install -g ./code-gate-0.1.0.tgz
```

The test suite covers both sides of the gate: it creates throwaway repositories with a bare remote, installs the hook, and asserts that a failing check makes `git push` exit non-zero while the remote stays untouched, and that the push succeeds once the check passes.

## Publishing to npm

```bash
npm login
npm version patch          # or minor / major
npm publish --access public
```

`prepublishOnly` runs a clean build, and the `files` field ships only `dist`, `README.md` and `LICENSE`. Verify the contents first with:

```bash
npm pack --dry-run
```

If the name `code-gate` is taken on the registry, publish under a scope: set `"name": "@your-scope/code-gate"` and keep the `code-gate` bin name so the command stays the same.

## Project structure

```text
src/
  cli.ts                  argument parsing, help, exit codes
  index.ts                programmatic API
  commands/
    check.ts              `code-gate` / `code-gate check`
    init.ts               `code-gate init`
    doctor.ts             `code-gate doctor`
    uninstall.ts          `code-gate uninstall`
  core/
    runner.ts             the orchestrator: detect -> select -> run -> collect
    types.ts              shared types
    exec.ts               child process helper, never throws
    diff.ts               line diff behind Prettier's line numbers
    report.ts             terminal output
    ui.ts                 colors, symbols, ASCII fallback
    json.ts               JSON-with-comments parsing
    stdin.ts              reads the hook's stdin with a timeout
  detect/
    project.ts            language, framework, tools, configs
    packageManager.ts     npm / yarn / pnpm / bun
    packages.ts           locate installed tools and their bin entries
    config.ts             .code-gate.json
  checks/
    index.ts              check registry and order
    prettier.ts           prettier --check
    prettierReport.ts     turns failing files into line-numbered diffs
    eslint.ts             eslint
    typescript.ts         tsc --noEmit
    script.ts             tests and build (package.json scripts)
    helpers.ts            file filtering, chunking, result helpers
  git/
    git.ts                repo info, hooks dir, pushed/changed files
  hook/
    template.ts           the pre-push script
    install.ts            install / update / uninstall
test/                     node:test suite, including real git push tests
```

Adding a check means writing one file in `src/checks/` and registering it in `src/checks/index.ts`.

## Requirements

Node.js 18 or newer, and Git. Zero runtime dependencies.

## License

MIT
