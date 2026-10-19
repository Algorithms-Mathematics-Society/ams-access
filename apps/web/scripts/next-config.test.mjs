import test from "node:test";
import assert from "node:assert/strict";
import config from "../next.config.mjs";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";

test("development skips persistent cache buffers while production keeps caching and chunk splitting", () => {
  for (const dev of [true, false]) {
    const cache = { type: "filesystem" };
    const webpack = { cache, optimization: { splitChunks: { cacheGroups: {} } } };
    const next = config(dev ? PHASE_DEVELOPMENT_SERVER : PHASE_PRODUCTION_BUILD);
    assert.equal(next.webpack(webpack, { dev, isServer: false }), webpack);
    assert.equal(webpack.cache, dev ? false : cache);
    assert(webpack.optimization.splitChunks.cacheGroups.editorParsers);
    assert(webpack.optimization.splitChunks.cacheGroups.katex);
  }
});
