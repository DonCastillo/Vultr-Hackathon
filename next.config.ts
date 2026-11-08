import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production Docker image (Dockerfile, target "web").
  output: "standalone",
};

export default nextConfig;
