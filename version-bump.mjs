import { readFileSync, writeFileSync } from "fs";

// Resolve target version: prefer the env var (set by `npm version` / `npm run`),
// fall back to package.json directly. The fallback matters when
// semantic-release calls this script via `node version-bump.mjs` outside of an
// `npm run` invocation — `process.env.npm_package_version` is unset there but
// package.json has already been updated by @semantic-release/npm.
const targetVersion = process.env.npm_package_version
	?? JSON.parse(readFileSync("package.json", "utf8")).version;

if (!targetVersion) {
	throw new Error("version-bump: could not resolve target version from env or package.json");
}

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
// but only if the target version is not already in versions.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!Object.values(versions).includes(minAppVersion)) {
    versions[targetVersion] = minAppVersion;
    writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
}
