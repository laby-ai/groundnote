module.exports = function buildBabelConfig(api) {
  const isDevelopment = api.env('development');

  return {
    presets: [
      [
        'next/babel',
        {
          'preset-react': {
            development: isDevelopment,
          },
        },
      ],
    ],
    plugins: isDevelopment ? ['@react-dev-inspector/babel-plugin'] : [],
  };
};
