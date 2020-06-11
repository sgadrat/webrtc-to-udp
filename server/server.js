'use strict';

const https = require('https');
const fs = require('fs');
const dgram = require('dgram');
const WebSocket = require('ws');
const wrtc = require('wrtc');

const destinations_whitelist = ['127.0.0.1']; // TODO load if from config-file/commandline/whatever

const use_ssl = false;
const ssl_key = '/path/to/privkey.pem'
const ssl_cert = '/path/to/fullchain.pem';

let clients = {};

function log(m) {
	console.log(`${Date.now()} ${m}`);
}

function dbg(m) {
}

function clean_client(client_id) {
	let client = clients[client_id];
	if (client.web_socket === null && client.data_channel === null) {
		log(`purging ${client_id}`);
		delete clients[client_id];
	}
}

function new_datachannel(client_id, chan) {
	log(`New data channel for ${client_id}`);
	clients[client_id].data_channel = chan;
	chan.onmessage = function(e) { datachannel_message(client_id, e.data); };
	chan.onclose = function(e) { datachannel_close(client_id); };
}

function datachannel_message(client_id, message) {
	dbg(`got a datachannel message from ${client_id}: ${typeof message}`);
	let client = clients[client_id];
	client.udp_socket.send(Buffer.from(message), client.relay_destination.port, client.relay_destination.address);
}

function datachannel_close(client_id) {
	log(`channel closed for ${client_id}`);
	clients[client_id].data_channel = null;
	clean_client(client_id);
}

function websocket_message(client_id, message) {
	dbg(`got a websocket message from ${client_id}`);
	let msg = JSON.parse(message);
	let client = clients[client_id];

	if (msg.type === 'relay.offer') {
		// Reject if the destination is not whitelisted
		if (destinations_whitelist.indexOf(msg.relay_destination.address) === -1) {
			log(`rejecting connection to unknown destination "${msg.relay_destination.address}"`);
			client.web_socket.close();
			return;
		}

		//TODO Resolve destination host (else it will be silently done by dgram.Socket.send() for each packet)

		// Create UDP socket based on msg.relay_destination
		client.relay_destination = msg.relay_destination;
		client.udp_socket = dgram.createSocket('udp4');
		client.udp_socket.bind();
		client.udp_socket.on('message', function(msg, remote_info) { udp_message(client_id, msg); });

		// Accept ICE offer
		client.wrtc_connection.setRemoteDescription(msg.ice_offer)
		.then(() => client.wrtc_connection.createAnswer())
		.then(answer => client.wrtc_connection.setLocalDescription(answer))
		.then(function() {
			dbg(`sending answer to ${client_id}`);
			client.web_socket.send(JSON.stringify({
				type: 'ice.answer',
				answer: client.wrtc_connection.localDescription,
			}))
		});
	}else if (msg.type === 'ice.candidate') {
		if (client.web_socket !== null && client.web_socket.readyState == WebSocket.OPEN) {
			client.wrtc_connection.addIceCandidate(msg.candidate);
		}
	}
}

function websocket_close(client_id) {
	log(`websocket closed for ${client_id}`);
	clients[client_id].web_socket = null;
	clean_client(client_id);
}

function udp_message(client_id, message) {
	dbg(`got an udp message for ${client_id}`);
	if (client_id in clients && clients[client_id].data_channel !== null) {
		clients[client_id].data_channel.send(message);
	}
}

let wss = null;
if (use_ssl) {
	const options = {
		key: fs.readFileSync(ssl_key),
		cert: fs.readFileSync(ssl_cert)
	};
	let server = https.createServer(options);
	server.on('error', (err) => console.error(err));
	server.listen(3003, () => console.log('HTTPS running on port 3003'));

	wss = new WebSocket.Server({server});
}else {
	wss = new WebSocket.Server({port: 3003});
}
wss.on('connection', function connection(ws, request, client) {
	let client_id = `${request.socket.remoteAddress}-${request.socket.remotePort}`;
	log(`new connection from ${client_id}`);

	// Initialize client's state
	clients[client_id] = {
		web_socket: ws,
		udp_socket: null,
		relay_destination: null,
		data_channel: null,
		wrtc_connection: new wrtc.RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		}),
	};

	// Configure WEBRTC peer connection
	let conn = clients[client_id].wrtc_connection;
	conn.ondatachannel = function(e) { new_datachannel(client_id, e.channel); };
	conn.onicecandidate = function(e) {
		if (e.candidate) {
			if (e.candidate.candidate != '') {
				dbg(`new ice candidate for ${client_id}`);
				ws.send(JSON.stringify({
					type: 'ice.candidate',
					candidate: e.candidate
				}));
			}
		}else {
			dbg(`end of candidates for ${client_id}`);
		}
	};

	// Handle messages on signaling websocket
	ws.on('message', function(message) { websocket_message(client_id, message); });
	ws.on('close', function() { websocket_close(client_id); });
});
