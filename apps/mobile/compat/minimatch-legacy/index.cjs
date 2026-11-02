// Adapt the old callable export; all matching and validation remain upstream.
const upstream = require('minimatch-engine');
function legacy(matcher) {
  return Object.assign((...args) => matcher(...args), matcher, {
    // eslint-plugin-import only calls .test(); upstream 11 deliberately removed
    // regex generation. Keep matching in its bounded engine, never rebuild regexes.
    makeRe: (pattern, options) => {
      const compiled = new matcher.Minimatch(pattern, options);
      return { test: (path) => compiled.match(path) };
    },
    defaults: (options) => legacy(matcher.defaults(options)),
  });
}
module.exports = legacy(upstream.minimatch);
