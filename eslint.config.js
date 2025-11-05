import fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import { common, modules, node, prettier, typescript, extend, ignores } from "@stegripe/eslint-config";

const gitIgnore = nodePath.resolve(fileURLToPath(import.meta.url), "..", ".gitignore");
const maybeGitIgnore = fs.existsSync(gitIgnore) ? [includeIgnoreFile(gitIgnore)] : [];

export default [...common, ...modules, ...node, ...prettier,
    // Local overrides to accommodate plugin version differences
    { rules: { "unicorn/no-unsafe-regex": "off", "unicorn/text-encoding-identifier-case": "off", "unicorn/numeric-separators-style": "off" } },
    ...extend(typescript, [{
        rule: "typescript/no-unnecessary-condition",
        option: ["off"]
    }], ...ignores), ...maybeGitIgnore, {
    ignores: [
        "dist/*",
        "ecosystem.config.cjs"
    ]
}, {
    files: ["api/**/*.ts"],
    rules: {
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-call": "off"
    }
}];