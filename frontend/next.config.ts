import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

// `next dev` proxies /api to the FastAPI server on 8000; the production build is
// a pure static export served by that same FastAPI process, where /api is already
// same-origin. Rewrites are unsupported under `output: 'export'`, so the two
// modes are mutually exclusive rather than merged.
const nextConfig: NextConfig = isDev
  ? {
      images: { unoptimized: true },
      async rewrites() {
        return [
          {
            source: '/api/:path*',
            destination: `${process.env.BACKEND_ORIGIN ?? 'http://localhost:8000'}/api/:path*`,
          },
        ];
      },
    }
  : {
      output: 'export',
      images: { unoptimized: true },
    };

export default nextConfig;
