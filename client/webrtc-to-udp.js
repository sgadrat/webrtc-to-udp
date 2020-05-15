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
			var sock = new WebSocket('ws://'+ relay_server.address +':'+ relay_server.port +'/');
			sock.onopen = function(e) {
				conn = new RTCPeerConnection({
					iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
				});
				chan = conn.createDataChannel("udp relay", {ordered: false, maxRetransmits: 0});

				conn.onicecandidate = function(e) {
					if (e.candidate) {
						if (e.candidate.candidate !== '') {
							console.log('sending an ICE candidate');
							sock.send(JSON.stringify({
								type: 'ice.candidate',
								candidate: e.candidate,
							}));
						}
					}else {
						console.log('end of candidates');
					}
				};

				chan.onopen = function(e) {
					console.log("conection opened");
					fulfill(chan);
				};

				conn.createOffer().then(function(offer) {
					console.log('created offer');
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
					console.log('got remote ICE candidate');
					conn.addIceCandidate(msg.candidate);
				}else if (msg.type === 'ice.answer') {
					console.log('got ICE answer');
					conn.setRemoteDescription(msg.answer);
				}else {
					console.log('unknown message type on websocket: '+ e.data);
				}
			};
		});
	},
};
