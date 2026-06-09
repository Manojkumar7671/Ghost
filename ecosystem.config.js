module.exports = {
  apps: [
    {
      name: "ghost-ai",
      script: "server.js",
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
  ],
};
