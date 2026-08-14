const fs = require('fs');
const projectEnv = '/Users/manojkumarmathangi/Ghost/.env';
const envPath = fs.existsSync(projectEnv) ? projectEnv : '.env';

module.exports = {
  apps: [
    {
      name: "ghost-ai",
      script: "server.js",
      node_args: `--env-file=${envPath}`,
      watch: false,
      ignore_watch: ["node_modules", "logs", "freellmapi", ".git", "scripts", "outputs", "data", "memory", "state"],
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      merge_logs: true,
    },
    {
      name: "freellmapi",
      script: "npm",
      args: "run dev",
      cwd: "./freellmapi",
      watch: false,
      env: {
        NODE_ENV: "development",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      merge_logs: true,
    }
  ],
};
