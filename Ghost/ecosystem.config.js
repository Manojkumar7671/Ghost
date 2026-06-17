module.exports = {
  apps: [{
    name: 'ghost',
    script: 'src/server.js',
    cwd: '/Users/manojkumarmathangi/Ghost',
    env: {
      GROQ_API_KEY: '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'
    },
    watch: false,
    restart_delay: 3000,
    max_restarts: 10
  }]
};
