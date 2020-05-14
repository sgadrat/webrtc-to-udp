'use strict';

const wrtc = require('wrtc');
const WebSocket = require('ws');

let clients = {};

function clean_client(client_id) {
	let client = clients[client_id];
	if (client.web_socket === null && client.data_channel === null) {
		console.log(`purging ${client_id}`);
		delete clients[client_id];
	}
}

function new_datachannel(client_id, chan) {
	console.log(`New data channel for ${client_id}`);
	clients[client_id].data_channel = chan;
	chan.onmessage = function(e) { datachannel_message(client_id, e.data); };
	chan.onclose = function(e) { datachannel_close(client_id); };
}

function datachannel_message(client_id, message) {
	console.log(`got a datachannel message from ${client_id}`);
	//TODO relay message
}

function datachannel_close(client_id) {
	console.log(`channel closed for ${client_id}`);
	clients[client_id].data_channel = null;
	clean_client(client_id);
}

function websocket_message(client_id, message) {
	console.log(`got a websocket message from ${client_id}`);
	let msg = JSON.parse(message);
	let client = clients[client_id];

	if (msg.type === 'relay.offer') {
		//TODO create udp socket based on msg.relay_destination
		client.wrtc_connection.setRemoteDescription(msg.ice_offer)
		.then(() => client.wrtc_connection.createAnswer())
		.then(answer => client.wrtc_connection.setLocalDescription(answer))
		.then(function() {
			console.log(`sending answer to ${client_id}`);
			client.web_socket.send(JSON.stringify({
				type: 'ice.answer',
				answer: client.wrtc_connection.localDescription,
			}))
		});
	}else if (msg.type === 'ice.candidate') {
		client.wrtc_connection.addIceCandidate(msg.candidate);
	}
}

function websocket_close(client_id) {
	console.log(`websocket closed for ${client_id}`);
	clients[client_id].web_socket = null;
	clean_client(client_id);
}

const wss = new WebSocket.Server({ port: 8080 });
wss.on('connection', function connection(ws, request, client) {
	let client_id = `${request.socket.remoteAddress}-${request.socket.remotePort}`;
	console.log(`new connection from ${client_id}`);

	// Initialize client's state
	clients[client_id] = {
		web_socket: ws,
		udp_socket: null,
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
				console.log(`new ice candidate for ${client_id}`);
				ws.send(JSON.stringify({
					type: 'ice.candidate',
					candidate: e.candidate
				}));
			}
		}else {
			console.log(`end of candidates for ${client_id}`);
		}
	};

	// Handle messages on signaling websocket
	ws.on('message', function(message) { websocket_message(client_id, message); });
	ws.on('close', function() { websocket_close(client_id); });
});
