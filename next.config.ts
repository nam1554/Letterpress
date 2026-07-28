import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forward all browser console output to the terminal (Next 16.2 AI tooling)
  logging: {
    browserToTerminal: true,
  },
};

export default nextConfig;
