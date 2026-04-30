import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // ioredis ships native-feel modules that Next's standalone tracer doesn't
  // pick up automatically. Treating it as an external server package leaves it
  // as a runtime require and includes it in the standalone node_modules.
  serverExternalPackages: ["ioredis"],
};

export default nextConfig;
