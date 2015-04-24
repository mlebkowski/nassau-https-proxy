var httpProxy = require('http-proxy'),
	execSync = require('child_process').execSync,
	sprintf = require("util").format,
	fs = require('fs'),
	path = require('path'),
	tls = require('tls'),
	https = require('https'),
	sys = require('sys');
	

var certPath = path.resolve(process.env.HOME, '.nassau-proxy'),
	listenPort = process.env.PORT || 443,
	forwardHost = process.env.FORWARD_HOST || 'localhost',
	forwardPort = process.env.FORWARD_PORT || 80;

function generateCertificate(name, CA) {
	var passKeyPath = path.resolve(certPath, name + ".pass.key"),
		keyPath = path.resolve(certPath, name + ".key"),
		csrPath = path.resolve(certPath, name + ".csr"),
		resultPath = path.resolve(certPath, name + ".crt");

	fs.existsSync(certPath) || fs.mkdirSync(certPath);
	
	function execSilent(command) {
		execSync(command, { stdio: [0, null, null] });
	}
	
	if (false === fs.existsSync(passKeyPath)) {
		console.log("Generating: " + passKeyPath);
		execSilent(sprintf('openssl genrsa -des3 -passout pass:nassauproxy -out "%s" 2048', passKeyPath));
	}

	if (false === fs.existsSync(keyPath)) {
		console.log("Generating: " + keyPath);
		execSilent(sprintf('openssl rsa -passin pass:nassauproxy -in "%s" -out "%s"', passKeyPath, keyPath));
	}
		
	if (false === fs.existsSync(csrPath)) {
		console.log('Generating: ' + csrPath);
		execSync(sprintf('openssl req -new -key "%s" -out "%s"', keyPath, csrPath), {
			"stdio": [null, null, null],
			"input": ["PL", "mazowieckie", "Warsaw", "Nassau SC", "", name, "", "", "", ""].join("\n")
		});
	} 
		
	if (false === fs.existsSync(resultPath)) {
		if (CA) {
			console.log("Signing the certificate using your own CA: " + resultPath);
			execSilent(sprintf('openssl x509 -req -days 365 -in "%s" -CA "%s" -CAkey "%s" -CAcreateserial -out "%s"',
				csrPath, CA.cert, CA.key, resultPath
			));

		} else {
			console.log("Add this cert as a trusted root to get rid of SSL warnings: " + resultPath);

			execSilent(sprintf('openssl x509 -req -days 365 -in "%s" -out "%s" -signkey "%s"',
				csrPath, resultPath, keyPath
			));
		}
	}
	
	return {
		"cert": resultPath,
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

console.log(sprintf("Listening on %s. Forwarding to http://%s:%d", listenPort, forwardHost, forwardPort));
