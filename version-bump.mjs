import { readFileSync, writeFileSync } from "fs";

// Always read from package.json on disk. We deliberately do NOT use
// `process.env.npm_package_version` because it has surprising values:
// - Inside `npm version`'s version script, it holds the OLD version (the
//   one being replaced) — using it there would write a stale manifest.
// - When semantic-release runs this script via `node version-bump.mjs`
//   outside `npm run`, it is unset.
// package.json on disk is always authoritative because @semantic-release/npm
// writes it before our exec prepareCmd runs.
const targetVersion = JSON.parse(readFileSync("package.json", "utf8")).version;

if (!targetVersion) {
	throw new Error("version-bump: package.json has no version field");
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
