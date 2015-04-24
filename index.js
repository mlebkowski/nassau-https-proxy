var httpProxy = require('http-proxy'),
	execSync = require('exec-sync'),
	sprintf = require("util").format,
	fs = require('fs'),
	path = require('path'),
	crypto = require('crypto'),
	https = require('https'),
	sys = require('sys');
	

var certPath = path.resolve(process.env.HOME, '.nassau-proxy'),
	listenPort = process.env.PORT || 443;

function generateCertificate(name, CA) {
	var passKeyPath = path.resolve(certPath, name + ".pass.key"),
		keyPath = path.resolve(certPath, name + ".key"),
		csrPath = path.resolve(certPath, name + ".csr"),
		resultPath = path.resolve(certPath, name + ".crt");
		
	fs.existsSync(certPath) || fs.mkdirSync(certPath);
	
	if (false === fs.existsSync(passKeyPath)) try {
		console.log("Generating: " + passKeyPath);
		execSync(sprintf('openssl genrsa -des3 -passout pass:nassauproxy -out "%s" 2048', passKeyPath));
	} catch (E) {}
	
	if (false === fs.existsSync(keyPath)) try {
		console.log("Generating: " + keyPath);
		execSync(sprintf('openssl rsa -passin pass:nassauproxy -in "%s" -out "%s"', passKeyPath, keyPath));
	} catch (E) {}
		
	if (false === fs.existsSync(csrPath)) try {
		console.log('Generating: ' + csrPath);
		execSync(sprintf("bash -c 'echo -e \"PL\\nmazowieckie\\nWarszawa\\nNassau SC\\n\\n"+name+"\\n\\n\\n\\n\\n\" | openssl req -new -key \"%s\" -out \"%s\"'",
			keyPath, csrPath
		));		
	} catch (E) {}
		
	if (false === fs.existsSync(resultPath)) try {
		if (CA) {
			console.log("Signing the certificate using your own CA: " + resultPath);
			execSync(sprintf('openssl x509 -req -days 365 -in "%s" -CA "%s" -CAkey "%s" -CAcreateserial -out "%s"',
				csrPath, CA.cert, CA.key, resultPath
			));

		} else {
			console.log("Add this cert as a trusted root to get rid of SSL warnings: " + resultPath);

			execSync(sprintf('openssl x509 -req -days 365 -in "%s" -out "%s" -signkey "%s"',
				csrPath, resultPath, keyPath
			));

		}
	} catch (E) {}
	
	return {
		"cert": resultPath,
		"key": keyPath
	}
}

// force the CA
var CA = generateCertificate('ssl.proxy.nassau');

var ssl = {
	SNICallback: function (domain) {
		var domainCert = generateCertificate(domain, CA);
		
		return crypto.createCredentials({
			key:  fs.readFileSync(domainCert.key),
			cert: fs.readFileSync(domainCert.cert),
			ca: [fs.readFileSync(CA.cert)]
		}).context;
	},
	key: fs.readFileSync(CA.key, 'utf8'),
	cert: fs.readFileSync(CA.cert, 'utf8'),
	requestCert: true,
	rejectUnauthorized: false
};

var proxy = httpProxy.createProxyServer({ target: { host: "localhost", port: 80 } });

proxy.on('proxyReq', function(proxyReq, req, res, options) {
  proxyReq.setHeader('X-Forwarded-Protocol', 'https');
  proxyReq.setHeader('X-Forwarded-Proto', 'https');
});
https.createServer(ssl, function(req, res) {
	proxy.web(req, res);
}).listen(listenPort);

console.log("Listening on " + listenPort);
