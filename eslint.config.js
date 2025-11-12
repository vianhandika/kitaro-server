import fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import { common, modules, node, prettier, typescript, extend, ignores } from "@stegripe/eslint-config";

const gitIgnore = nodePath.resolve(fileURLToPath(import.meta.url), "..", ".gitignore");
const maybeGitIgnore = fs.existsSync(gitIgnore) ? [includeIgnoreFile(gitIgnore)] : [];

export default [{ ignores: ["**/*"] }];