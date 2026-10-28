export class Container {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async startAndWaitForPorts(options) { return this.ctx.start(options, this.envVars); }
  renewActivityTimeout() { this.ctx.renewed = (this.ctx.renewed || 0) + 1; }
  async stop() { this.ctx.stopped = true; }
}
export function getContainer(binding, name) {
  return binding.get(binding.idFromName(name));
}
