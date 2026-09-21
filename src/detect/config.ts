import path from 'node:path';

import { fileExists, readJsonFile } from '../core/json';
import type { GateConfig, ProjectInfo } from '../core/types';

export const CONFIG_FILE_NAMES = ['.code-gate.json', 'code-gate.json'];

interface RawConfig {
    checks?: {
        prettier?: boolean;
        eslint?: boolean;
        typescript?: boolean;
        tests?: boolean;
        build?: boolean;
    };
    requireTests?: boolean;
    requireBuild?: boolean;
    changedFilesOnly?: boolean;
    ignore?: string[];
}

const DEFAULT_CONFIG: GateConfig = {
    checks: { prettier: true, eslint: true, typescript: true, tests: true, build: true },
    requireTests: false,
    requireBuild: false,
    changedFilesOnly: true,
    ignore: [],
};

export interface LoadConfigOptions {
    /** CLI overrides win over the config file. */
    overrides?: Partial<GateConfig> & { checks?: Partial<GateConfig['checks']> };
}

export function loadConfig(project: ProjectInfo, options: LoadConfigOptions = {}): GateConfig {
    let configPath: string | undefined;
    let raw: RawConfig | undefined;

    for (const name of CONFIG_FILE_NAMES) {
        const candidate = path.join(project.root, name);
        if (fileExists(candidate)) {
            configPath = candidate;
            raw = readJsonFile<RawConfig>(candidate) ?? {};
            break;
        }
    }

    const config: GateConfig = {
        checks: { ...DEFAULT_CONFIG.checks, ...(raw?.checks ?? {}) },
        requireTests: raw?.requireTests ?? DEFAULT_CONFIG.requireTests,
        requireBuild: raw?.requireBuild ?? DEFAULT_CONFIG.requireBuild,
        changedFilesOnly: raw?.changedFilesOnly ?? DEFAULT_CONFIG.changedFilesOnly,
        ignore: raw?.ignore ?? DEFAULT_CONFIG.ignore,
        configPath,
    };

    const overrides = options.overrides;
    if (overrides) {
        Object.assign(config, { ...overrides, checks: { ...config.checks, ...(overrides.checks ?? {}) } });
    }

    return config;
}

export const defaultConfig = DEFAULT_CONFIG;
