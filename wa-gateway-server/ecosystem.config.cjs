module.exports = {
    apps: [{
        name: "nexshop-wa-api",
        script: "server.js",
        cwd: __dirname,
        instances: 1,
        autorestart: true,
        watch: false,
        env: {
            NODE_ENV: "production",
            HOST: "127.0.0.1",
            PORT: 8080
        }
    }]
};
