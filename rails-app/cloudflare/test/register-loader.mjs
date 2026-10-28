import { registerHooks } from "node:module";
const nativeMock="data:text/javascript,"+encodeURIComponent("export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return {url:nativeMock,shortCircuit:true};
    if (specifier === "@cloudflare/containers") {
      return { url: new URL("./container-api-mock.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
