/**
 * Shared types for the code-gate orchestrator.
 */

export type Language = 'typescript' | 'javascript' | 'unknown';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

/** Result state of a single check. */
export type CheckStatus =
    /** Check ran and succeeded. */
    | 'pass'
    /** Check ran and failed -> blocks the push. */
    | 'fail'
    /** Check does not apply to this project (missing tool/config/files). */
    | 'skip'
    /** Check could not run, but must not block the push. */
    | 'warn';

export interface PackageJson {
    name?: string;
    version?: string;
    private?: boolean;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    /** Legacy inline ESLint config. */
    eslintConfig?: unknown;
    /** Inline Prettier config. */
    prettier?: unknown;
    [key: string]: unknown;
}

/** A tool discovered inside the project (node_modules). */
export interface ToolInfo {
    name: string;
    /** True when the package is resolvable from the project. */
    installed: boolean;
    version?: string;
    /** Absolute path to the package directory. */
    packageDir?: string;
    /** Absolute path to the executable JS entry point. */
    binPath?: string;
    /** Config file that was detected for this tool, if any. */
    configPath?: string;
    /** Set when the config lives inside package.json. */
    configInPackageJson?: boolean;
}

export interface ProjectInfo {
    /** Directory that holds package.json (or cwd when there is none). */
    root: string;
    gitRoot?: string;
    packageJsonPath?: string;
    pkg?: PackageJson;
    language: Language;
    /** Why the language was detected the way it was. */
    languageReasons: string[];
    /** e.g. ['Next.js', 'React'] */
    frameworks: string[];
    /** Human readable primary label, e.g. 'Next.js'. */
    frameworkLabel: string;
    packageManager: PackageManager;
    packageManagerReason: string;
    tsconfigPath?: string;
    /** `composite: true` requires extra flags for `tsc --noEmit`. */
    tsconfigComposite: boolean;
    scripts: Record<string, string>;
    tools: {
        prettier: ToolInfo;
        eslint: ToolInfo;
        typescript: ToolInfo;
    };
}

export interface ResolvedChecksConfig {
    prettier: boolean;
    eslint: boolean;
    typescript: boolean;
    tests: boolean;
    build: boolean;
}

export interface GateConfig {
    checks: ResolvedChecksConfig;
    /** Fail when the project has no test script. */
    requireTests: boolean;
    /** Fail when the project has no build script. */
    requireBuild: boolean;
    /** Limit Prettier/ESLint to changed files. */
    changedFilesOnly: boolean;
    /** Extra globs never sent to Prettier/ESLint. */
    ignore: string[];
    /** Absolute path of the .code-gate.json that was loaded. */
    configPath?: string;
}

export interface FileSelection {
    /** Files being pushed / changed, relative to the project root, POSIX separators. */
    files: string[];
    /** How the list was produced (shown in verbose output). */
    strategy: string;
    /** True when the whole project is being checked instead of a diff. */
    isFullScan: boolean;
}

export interface CheckResult {
    id: string;
    name: string;
    status: CheckStatus;
    /** Short one line explanation, e.g. 'Not configured'. */
    message?: string;
    /** Raw tool output, printed when the check fails. */
    output?: string;
    command?: string;
    durationMs: number;
}

export interface CheckContext {
    project: ProjectInfo;
    config: GateConfig;
    selection: FileSelection;
    verbose: boolean;
    /** Environment injected into every child process. */
    childEnv: NodeJS.ProcessEnv;
}

export interface Check {
    id: keyof ResolvedChecksConfig;
    name: string;
    run(ctx: CheckContext): Promise<CheckResult>;
}
