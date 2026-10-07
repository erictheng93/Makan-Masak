#!/usr/bin/env node
"use strict";

// Exercise the installed dependency boundaries; run after pnpm install.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

function packageRoot(entry) {
  let directory = path.dirname(entry);
  while (!fs.existsSync(path.join(directory, "package.json"))) {
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, "Dependency manifest missing: " + entry);
    directory = parent;
  }
  return directory;
}

function checkExceptionScope(yaml, installedRoots) {
  const lockDocuments = [];
  yaml.safeLoadAll(
    fs.readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8"),
    (document) => lockDocuments.push(document),
  );
  const workspace = yaml.safeLoad(
    fs.readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8"),
  );
  const versions = {
    artillery: "2.0.34",
    braces: "3.0.3",
    "http-cache-semantics": "4.2.0",
    "sprintf-js": "1.0.3",
    "csv-parse": "7.0.3",
    xlsx: "0.20.3",
  };
  for (const [name, version] of Object.entries(versions)) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(installedRoots[name], "package.json"), "utf8"),
    );
    assert.equal(manifest.name, name);
    assert.equal(
      manifest.version,
      version,
      "Installed exception scope: " + name,
    );
  }
  for (const name of [
    "artillery",
    "braces",
    "http-cache-semantics",
    "sprintf-js",
  ]) {
    const key = name + "@" + versions[name];
    const patchPath = "patches/" + key + ".patch";
    const digest = createHash("sha256")
      .update(fs.readFileSync(path.join(ROOT, patchPath)))
      .digest("hex");
    assert.equal(workspace.patchedDependencies[key], patchPath);
    const hashes = lockDocuments
      .map((d) => d.patchedDependencies?.[key])
      .filter((value) => value !== undefined);
    assert.ok(hashes.length > 0, "Missing locked patch: " + key);
    for (const hash of hashes)
      assert.equal(hash, digest, "Stale patch: " + key);
    const packageKeys = lockDocuments
      .flatMap((d) => Object.keys(d.packages || {}))
      .filter((entry) => entry.startsWith(name + "@"));
    assert.ok(packageKeys.length > 0, "Missing locked package: " + name);
    for (const entry of packageKeys) assert.equal(entry.split("(")[0], key);
    const snapshots = lockDocuments
      .flatMap((d) => Object.keys(d.snapshots || {}))
      .filter((entry) => entry.startsWith(name + "@"));
    assert.ok(snapshots.length > 0, "Missing patched snapshot: " + key);
    for (const entry of snapshots) {
      assert.equal(entry.split("(")[0], key);
      assert.ok(
        entry.includes("(patch_hash=" + digest + ")"),
        "Unpatched locked snapshot: " + entry,
      );
    }
  }

  const tarball = "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz";
  const integrity =
    "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==";
  const xlsxEntries = lockDocuments
    .flatMap((d) => Object.entries(d.packages || {}))
    .filter(([key]) => key.startsWith("xlsx@"));
  assert.ok(xlsxEntries.length > 0, "Missing SheetJS lock entry");
  for (const [key, value] of xlsxEntries) {
    assert.equal(key, "xlsx@" + tarball);
    assert.deepEqual(value.resolution, { integrity, tarball });
  }
  const adminManifest = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "apps/admin-dashboard/package.json"),
      "utf8",
    ),
  );
  assert.equal(adminManifest.dependencies.xlsx, tarball);
  console.log(
    "PASS: exact exception versions, patch hashes and SheetJS CDN integrity",
  );
}

function checkHttpCache(CachePolicy) {
  const blockedResponses = [
    { "cache-control": "max-age=60", "set-cookie": "session=alice" },
    { "cache-control": "max-age=60, proxy-revalidate" },
    { "cache-control": "max-age=60, no-cache" },
    { pragma: "no-cache" },
    { "cache-control": "max-age=60, no-store" },
    { "cache-control": "max-age=60, private" },
    { "cache-control": "max-age=60, must-revalidate" },
  ];

  for (const method of ["GET", "HEAD"]) {
    const request = {
      method,
      url: "https://cache.example.test/session",
      headers: { host: "cache.example.test" },
    };
    for (const headers of blockedResponses) {
      const responseHeaders = { age: "1", etag: '"session"', ...headers };
      if (headers["cache-control"]) {
        responseHeaders["cache-control"] +=
          ", stale-while-revalidate=600, stale-if-error=600";
      }
      const original = new CachePolicy(request, {
        status: 200,
        headers: responseHeaders,
      });
      const restored = CachePolicy.fromObject(
        JSON.parse(JSON.stringify(original.toObject())),
      );
      const revalidated = original.revalidatedPolicy(request, {
        status: 304,
        headers: { etag: '"session"' },
      }).policy;

      for (const policy of [original, restored, revalidated]) {
        const label = JSON.stringify({ method, headers });
        for (const directive of [
          "max-stale",
          "max-stale=999999",
          'max-stale="999999"',
        ]) {
          const incoming = {
            ...request,
            headers: { ...request.headers, "cache-control": directive },
          };
          const result = policy.evaluateRequest(incoming);
          assert.equal(result.response, undefined, label + " " + directive);
          assert.equal(result.revalidation.synchronous, true, label);
          assert.equal(policy.satisfiesWithoutRevalidation(incoming), false);
        }
        assert.equal(policy.useStaleWhileRevalidate(), false, label);
        const onError = policy.revalidatedPolicy(request, {
          status: 503,
          headers: {},
        });
        assert.equal(onError.modified, true, label + " stale-if-error");
      }
    }

    const controls = [
      [{ "cache-control": "max-age=60" }, {}, true],
      [{ "cache-control": "max-age=0" }, {}, true],
      [
        { "cache-control": "public, max-age=60", "set-cookie": "id=public" },
        {},
        true,
      ],
      [
        { "cache-control": "immutable, max-age=60", "set-cookie": "id=public" },
        {},
        true,
      ],
      [
        { "cache-control": "max-age=60", "set-cookie": "session=alice" },
        { shared: false },
        true,
      ],
      [
        { "cache-control": "max-age=60, proxy-revalidate" },
        { shared: false },
        true,
      ],
      [{ "cache-control": "max-age=0", vary: "*" }, {}, false],
    ];
    for (const [headers, options, allowed] of controls) {
      const policy = new CachePolicy(
        request,
        { status: 200, headers: { age: "1", ...headers } },
        options,
      );
      const incoming = {
        ...request,
        headers: { ...request.headers, "cache-control": "max-stale=999999" },
      };
      assert.equal(policy.satisfiesWithoutRevalidation(incoming), allowed);
    }

    const expired = new CachePolicy(request, {
      status: 200,
      headers: { age: "120", "cache-control": "max-age=60" },
    });
    assert.equal(expired.satisfiesWithoutRevalidation(request), false);
    assert.equal(
      expired.satisfiesWithoutRevalidation({
        ...request,
        headers: { ...request.headers, "cache-control": "max-stale=10" },
      }),
      false,
    );
    const ordinaryStale = new CachePolicy(request, {
      status: 200,
      headers: {
        age: "120",
        "cache-control":
          "max-age=60, stale-while-revalidate=600, stale-if-error=600",
      },
    });
    assert.equal(ordinaryStale.useStaleWhileRevalidate(), true);
    assert.equal(
      ordinaryStale.evaluateRequest(request).revalidation.synchronous,
      false,
    );
    assert.equal(
      ordinaryStale.revalidatedPolicy(request, { status: 503, headers: {} })
        .modified,
      false,
    );
  }
  console.log(
    "PASS: HTTP cache security prohibitions and legitimate stale reuse",
  );
}

async function checkArtilleryCsv(artilleryRoot, fixtureParent = os.tmpdir()) {
  const { default: preparePlan } = await import(
    pathToFileURL(
      path.join(artilleryRoot, "dist/lib/util/prepare-test-execution-plan.js"),
    )
  );
  await import(pathToFileURL(path.join(artilleryRoot, "dist/lib/cmds/run.js")));
  const fixtureRoot = fs.mkdtempSync(
    path.join(fixtureParent, "artillery-csv-"),
  );
  const payloadPath = path.join(fixtureRoot, "payload.csv");
  const scenarioPath = path.join(fixtureRoot, "scenario.json");
  const previous = global.artillery;
  global.artillery = { testRunId: "dependency-security-check" };
  const writeScenario = (payload) => {
    fs.writeFileSync(
      scenarioPath,
      JSON.stringify({
        config: {
          target: "http://127.0.0.1:1",
          phases: [{ duration: 1, arrivalCount: 1 }],
          payload: { path: payloadPath, fields: ["name", "count"], ...payload },
        },
        scenarios: [{ flow: [{ get: { url: "/" } }] }],
      }),
    );
  };
  try {
    fs.writeFileSync(payloadPath, 'name;count\n"Alice;A";2\n\nBob;3\n');
    writeScenario({ skipHeader: true, delimiter: ";" });
    const plan = await preparePlan([scenarioPath], {}, {});
    assert.deepEqual(plan.config.payload[0].data, [
      ["Alice;A", 2],
      ["Bob", 3],
    ]);

    fs.writeFileSync(payloadPath, "__proto__,__proto__,name\nx,y,Alice\n");
    writeScenario({ options: { columns: true, group_columns_by_name: true } });
    const safePlan = await preparePlan([scenarioPath], {}, {});
    const record = safePlan.config.payload[0].data[0];
    assert.equal(Object.getPrototypeOf(record), Object.prototype);
    assert.equal(Object.hasOwn(record, "__proto__"), true);
    assert.deepEqual(record.__proto__, ["x", "y"]);
    assert.equal(record.name, "Alice");

    fs.writeFileSync(payloadPath, '"unterminated');
    await assert.rejects(() => preparePlan([scenarioPath], {}, {}), {
      code: "CSV_QUOTE_NOT_CLOSED",
    });
  } finally {
    global.artillery = previous;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log("PASS: Artillery run imports, CSV payloads and prototype safety");
}

function checkBraces(braces) {
  const nested = (open, close, depth) =>
    open.repeat(depth) + "a" + close.repeat(depth);
  const depthError = (error) =>
    error instanceof RangeError && /nesting depth exceeds/.test(error.message);
  for (const method of ["parse", "compile", "expand", "stringify"]) {
    for (const [open, close] of [
      ["{", "}"],
      ["(", ")"],
      ["{(", ")}"],
    ]) {
      assert.throws(
        () => braces[method](nested(open, close, 2200)),
        depthError,
      );
      assert.throws(() => braces[method](nested(open, close, 101)), depthError);
    }
  }
  assert.throws(() => braces(nested("{", "}", 4400)), depthError);
  assert.throws(() => braces.create(nested("(", ")", 4400)), depthError);
  for (const method of ["compile", "expand", "stringify"]) {
    let ast = { type: "text", value: "a" };
    for (let i = 0; i < 4400; i++) ast = { type: "root", nodes: [ast] };
    assert.throws(() => braces[method](ast), depthError);
    const cyclic = { type: "root", nodes: [] };
    cyclic.nodes.push(cyclic);
    assert.throws(() => braces[method](cyclic), {
      name: "TypeError",
      message: "Cannot traverse a cyclic AST",
    });
  }
  const parentCycle = { type: "paren", nodes: [] };
  parentCycle.parent = parentCycle;
  assert.throws(
    () => braces.expand({ type: "root", nodes: [parentCycle] }),
    depthError,
  );
  for (const [open, close] of [
    ["{", "}"],
    ["(", ")"],
  ]) {
    const value = nested(open, close, 100);
    assert.equal(braces.compile(value), value);
    assert.equal(braces.stringify(braces.parse(value)), value);
  }
  assert.equal(braces.compile("a/{b,c}/d"), "a/(b|c)/d");
  assert.deepEqual(braces.expand("{1..3}"), ["1", "2", "3"]);
  assert.deepEqual(braces.expand("./src/**/*.{vue,js,ts,jsx,tsx}"), [
    "./src/**/*.vue",
    "./src/**/*.js",
    "./src/**/*.ts",
    "./src/**/*.jsx",
    "./src/**/*.tsx",
  ]);
  // Quoted, escaped and bracketed braces are literals, not AST nesting.
  for (const value of [
    '"'.concat("{".repeat(101), '"'),
    "\\{".repeat(101),
    "[" + "{".repeat(101) + "]",
  ]) {
    assert.doesNotThrow(() => braces.compile(value));
  }
  const shared = { type: "text", value: "a" };
  assert.equal(
    braces.stringify({ type: "root", nodes: [shared, shared] }),
    "aa",
  );
  assert.equal(braces.stringify(braces.parse("a/{b,c}/d").nodes[2]), "{b,c}");
}

function checkSprintf({ sprintf, vsprintf }) {
  const value = 1.25;
  for (const type of ["e", "f", "g"]) {
    const native = { e: "toExponential", f: "toFixed", g: "toPrecision" }[type];
    for (const precision of ["0", "101", "9".repeat(400)]) {
      const bounded = precision === "0" ? (type === "g" ? 1 : 0) : 100;
      assert.equal(
        sprintf("%." + precision + type, value),
        value[native](bounded),
      );
    }
  }
  assert.equal(sprintf("%.2f", value), "1.25");
  assert.equal(sprintf("%(value).101f", { value }), value.toFixed(100));
  assert.equal(sprintf("%2$.101f", "ignored", value), value.toFixed(100));
  assert.equal(vsprintf("%.101f", [value]), value.toFixed(100));
  assert.equal(sprintf("%.150s", "x".repeat(150)), "x".repeat(150));
  const tree = sprintf.parse("%.2f");
  tree[0][7] = "9".repeat(400);
  assert.equal(sprintf.format(tree, ["%.2f", value]), value.toFixed(100));
  const format = "%.3f";
  sprintf(format, value);
  const oldPrecision = sprintf.cache[format][0][7];
  try {
    sprintf.cache[format][0][7] = "101";
    assert.equal(sprintf(format, value), value.toFixed(100));
  } finally {
    sprintf.cache[format][0][7] = oldPrecision;
  }
  console.log(
    "PASS: sprintf numeric precision, direct trees and cached formats",
  );
}

async function main() {
  const artilleryManifest = require.resolve("artillery/package.json");
  const artilleryRequire = createRequire(artilleryManifest);
  const gotRequire = createRequire(artilleryRequire.resolve("got"));
  const cacheableRequire = createRequire(
    gotRequire.resolve("cacheable-request"),
  );
  const chokidarRequire = createRequire(artilleryRequire.resolve("chokidar"));
  const yamlRequire = createRequire(artilleryRequire.resolve("js-yaml"));
  const argparseRequire = createRequire(yamlRequire.resolve("argparse"));
  const adminRequire = createRequire(
    path.join(ROOT, "apps/admin-dashboard/package.json"),
  );
  const roots = {
    artillery: path.dirname(artilleryManifest),
    braces: packageRoot(chokidarRequire.resolve("braces")),
    "http-cache-semantics": packageRoot(
      cacheableRequire.resolve("http-cache-semantics"),
    ),
    "sprintf-js": packageRoot(argparseRequire.resolve("sprintf-js")),
    "csv-parse": packageRoot(artilleryRequire.resolve("csv-parse")),
    xlsx: packageRoot(adminRequire.resolve("xlsx")),
  };
  checkExceptionScope(artilleryRequire("js-yaml"), roots);
  checkHttpCache(cacheableRequire("http-cache-semantics"));
  await checkArtilleryCsv(path.dirname(artilleryManifest));
  checkBraces(chokidarRequire("braces"));
  console.log("PASS: braces strings, AST depth and normal glob patterns");
  checkSprintf(argparseRequire("sprintf-js"));
  checkSprintf(require(path.join(roots["sprintf-js"], "dist/sprintf.min.js")));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  checkExceptionScope,
  checkHttpCache,
  checkArtilleryCsv,
  checkBraces,
  checkSprintf,
};
