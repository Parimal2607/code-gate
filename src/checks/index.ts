import type { Check } from '../core/types';
import { eslintCheck } from './eslint';
import { prettierCheck } from './prettier';
import { buildCheck, testsCheck } from './script';
import { typescriptCheck } from './typescript';

/**
 * Registry of available checks, executed in this order.
 *
 * Fast, file-scoped checks run first so obvious problems surface before the
 * expensive project-wide ones. Adding a new check means adding it here.
 */
export const checks: Check[] = [prettierCheck, eslintCheck, typescriptCheck, testsCheck, buildCheck];

export { prettierCheck, eslintCheck, typescriptCheck, testsCheck, buildCheck };
