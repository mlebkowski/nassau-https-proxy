#!/usr/bin/env node

const httpProxy = require('http-proxy');
const execSync = require('child_process').execSync;
const format = require("util").format;
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const https = require('https');

if (!execSync) {
    console.log("execSync() is missing. Are you running node v0.12?");
    process.exit(1);
}

const listenPort = process.env.PORT || 443;
const forwardHost = process.env.FORWARD_HOST || 'localhost';
const forwardPort = process.env.FORWARD_PORT || 80;
const caName = process.env.CA_NAME || 'ssl.proxy.nassau.narzekasz.pl';
const proxyTimeout = process.env.PROXY_TIMEOUT || 5*60;

const version = require('./package.json').version.split('.')[0];
const dataPath = process.env.DATA_PATH || path.resolve(process.env.HOME, '.nassau-proxy/v' + version);

const environment = {
    DATA_PATH: dataPath,
    CERT_PATH: format("%s/%s.crt", dataPath, "%s"),
    KEY_PATH: format("%s/%s.key", dataPath, "%s"),
    OPENSSL_CONFIG: path.resolve(__dirname, 'openssl.conf')
}

function generateKeyPath(domain) {
    return format(environment.KEY_PATH, domain);
}

function generateCertPath(domain) {
    return format(environment.CERT_PATH, domain);
}

function generateCertificate(name) {
    const certPath = generateCertPath(name);
    const keyPath = generateKeyPath(name);

    if (false === fs.existsSync(certPath)) {
      console.log("Generating certificate: " + certPath);
    }

    execSync(format('%s/make-cert "%s" "%s"', __dirname, caName, name), {stdio: [0, null, null], env: environment});

    return {
        "cert": certPath,
        "key": keyPath
    }
}

const caCert = generateCertPath(caName);
const caKey = generateKeyPath(caName);

if (false === fs.existsSync(caCert)) {
  console.log("Add this cert as a trusted CA Root to get rid of SSL warnings: " + caCert);

  // force the CA
  execSync(format('%s/make-cert "%s"', __dirname, caName), {stdio: [0, null, null], env: environment});
}

if (process.env.POSTINSTALL) {
    if ("darwin" === process.platform) {
        console.log(format("Adding %s as a trusted certificate to system keychain. \n"
            + "Please provide your root password when asked or skip this step:", caCert));
        execSync(format('sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "%s"', caCert));
    }
    process.exit();
}

const ssl = {
    SNICallback: function (domain, callback) {
        const domainCert = generateCertificate(domain),
            ctx = tls.createSecureContext({
                key: fs.readFileSync(domainCert.key),
                cert: fs.readFileSync(domainCert.cert),
                ca: [fs.readFileSync(caCert)],
                ciphers: "AES128+EECDH:AES128+EDH"
            });

        return callback(null, ctx);
    },

    key: fs.readFileSync(caKey),
    cert: fs.readFileSync(caCert)
};

const proxy = httpProxy.createProxyServer({
    target: {
        host: forwardHost,
        port: forwardPort
    },
    proxyTimeout: proxyTimeout*1000
});

proxy.on('error', function (err, req, res) {
    res.writeHead && res.writeHead(500, {
        'Content-Type': 'text/plain'
    });

    res.end('Something went wrong.');
});

proxy.on('proxyReq', function (proxyReq, req, res, options) {
    proxyReq.setHeader('X-Forwarded-Protocol', 'https');
    proxyReq.setHeader('X-Forwarded-Proto', 'https');
    proxyReq.setHeader('X-Forwarded-Port', listenPort);
});

https.createServer(ssl, function (req, res) {
    console.log(req.method + " https://" + req.headers.host + req.url);
    proxy.web(req, res);
}).on('upgrade', function (req, socket, head) {
    proxy.ws(req, socket, head);
}).listen(listenPort);

console.log("Listening on %s. Forwarding to http://%s:%d", listenPort, forwardHost, forwardPort);
