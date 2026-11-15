/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the running preview's build intact while validating the next revision.
  distDir: process.env.HOTELAI_VALIDATION_BUILD === 'local-ai' ? '.next-local-ai'
    : process.env.HOTELAI_VALIDATION_BUILD === '1' ? '.next-validation' : '.next',
};

export default nextConfig;
