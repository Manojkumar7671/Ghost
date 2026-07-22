module.exports = {
  apps: [
    {
      name: "ghost-ai",
      script: "server.js",
      node_args: "--env-file=.env",
      watch: true,
      ignore_watch: ["node_modules", "logs"],
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
