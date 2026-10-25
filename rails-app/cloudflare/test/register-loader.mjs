import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@cloudflare/containers") {
      return { url: new URL("./container-api-mock.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
