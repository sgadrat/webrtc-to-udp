var wtu = {
	/**
	 * @brief Get a data channel that can be used to send UDP datagrams to destination through a WEBRTC relay
	 * @param relay_server Description of the relay server
	 * @param destination Description the destinations
	 *
	 * relay_server properties:
	 *  {
	 *    "address": string, // IP or host of the relay
	 *    "port": int, // Port on which the relay listens for connection offers
	 *    "ssl": bool, // True to connect to the relay server with a secure web socket
	 *  }
	 *
	 * destination properties:
	 *  {
	 *    "address": string, // IP or host of the destination
	 *    "port": int, // Destination port
	 *  }
	 */
	get_channel: function(relay_server, destination) {
		return new Promise(function(fulfill, reject) {
			var conn = null;
			var chan = null;
			var sock = new WebSocket((relay_server.ssl?'wss':'ws') +'://'+ relay_server.address +':'+ relay_server.port +'/');
			sock.onopen = function(e) {
				conn = new RTCPeerConnection({
					iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
				});
				chan = conn.createDataChannel("udp relay", {ordered: false, maxRetransmits: 0});

				conn.onicecandidate = function(e) {
					if (e.candidate) { // candidate is null when the list is complete
						if (e.candidate.candidate !== '') { // Firefox adds an empty candidate at the end of the list
							// Send the ICE candidate over websocket
							sock.send(JSON.stringify({
								type: 'ice.candidate',
								candidate: e.candidate,
							}));
						}
					}
				};

				chan.onopen = function(e) {
					// Connection opened, fulfill the promise
					fulfill(chan);
				};

				conn.createOffer().then(function(offer) {
					// Created offer, set it as local description and send it to the relay
					conn.setLocalDescription(offer).then(function () {
						sock.send(JSON.stringify({
							type: 'relay.offer',
							relay_destination: destination,
							ice_offer: conn.localDescription
						}));
					});
				});
			};

			sock.onmessage = function(e) {
				msg = JSON.parse(e.data);
				if (msg.type === 'ice.candidate') {
					conn.addIceCandidate(msg.candidate);
				}else if (msg.type === 'ice.answer') {
					conn.setRemoteDescription(msg.answer);
				}else {
					console.error('unknown message type on websocket: '+ e.data);
				}
			};
		});
	},
};
