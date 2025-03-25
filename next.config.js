/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@browserbasehq/stagehand'],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        os: false,
        path: false,
        stream: false,
        util: false,
        url: false,
        http: false,
        https: false,
        zlib: false,
        querystring: false,
      }
    }
    return config
  }
}

export default nextConfig 