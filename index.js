var httpProxy = require('http-proxy'),
	execSync = require('child_process').execSync,
	format = require("util").format,
	fs = require('fs'),
	path = require('path'),
	tls = require('tls'),
	https = require('https'),
	sys = require('sys');
	

var homePath = path.resolve(process.env.HOME, '.nassau-proxy'),
	listenPort = process.env.PORT || 443,
	forwardHost = process.env.FORWARD_HOST || 'localhost',
	forwardPort = process.env.FORWARD_PORT || 80;

function generateCertificate(name, CA) {
	var keyPath = path.resolve(homePath, name + ".key"),
		csrPath = path.resolve(homePath, name + ".csr"),
		certPath = path.resolve(homePath, name + ".crt"),
		subject = "/C=PL/ST=mazowieckie/L=Warsaw/O=Nassau SC/CN=" + name,
		command = format(
			'openssl req -newkey rsa:2048 -sha256 -nodes -keyout "%s" -out "%s" -subj "%s"',
			keyPath, csrPath, subject
		);

	fs.existsSync(homePath) || fs.mkdirSync(homePath);
	
	if (false === fs.existsSync(certPath)) {
		
		if (CA) {
			console.log("Generating certificate: " + certPath);
			
			// signing key and request:
			execSync(command, { stdio: [0, null, null] });
			
			command = format(
				'openssl x509 -req -days 1001 -sha256 -in "%s" -out "%s" -CA "%s" -CAkey "%s" -CAcreateserial',
				csrPath, certPath, CA.cert, CA.key
			);
		} else {
			console.log("Add this cert as a trusted CA Root to get rid of SSL warnings: " + certPath);
			
			command = (command + " -x509 -days 1001").replace(csrPath, certPath);
		}

		execSync(command, { stdio: [0, null, null] });		
	}
	
	return {
		"cert": certPath,
		"key": keyPath
	}
}

// force the CA
var CA = generateCertificate('ssl.proxy.nassau');

var ssl = {
	SNICallback: function (domain, callback) {
		var domainCert = generateCertificate(domain, CA),
			ctx = tls.createSecureContext({
				key:  fs.readFileSync(domainCert.key),
				cert: fs.readFileSync(domainCert.cert),
				ca:   [fs.readFileSync(CA.cert)],
				ciphers: "AES128+EECDH:AES128+EDH"
			});
		
		return callback(null, ctx);
	},
	
	key: fs.readFileSync(CA.key),
	cert: fs.readFileSync(CA.cert)
};

var proxy = httpProxy.createProxyServer({ target: { host: forwardHost, port: forwardPort } });

proxy.on('proxyReq', function(proxyReq, req, res, options) {
  proxyReq.setHeader('X-Forwarded-Protocol', 'https');
  proxyReq.setHeader('X-Forwarded-Proto', 'https');
});

https.createServer(ssl, function(req, res) {
	console.log(req.method + " https://" + req.headers.host + req.url);
	proxy.web(req, res);
}).listen(listenPort);

console.log("Listening on %s. Forwarding to http://%s:%d", listenPort, forwardHost, forwardPort);
