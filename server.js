var app = require('http').createServer(handler)
  , sio = require('socket.io').listen(app)
  , fs = require('fs');

var port = process.env.PORT || 8123;
app.listen(port);

function handler (req, res) {
  fs.readFile(__dirname + '/index.html',
  function (err, data) {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading index.html');
    }

    res.writeHead(200);
    res.end(data);
  });
}

var bumps = [];
var groups = [];
var clients = {};
var clientHistoryMaxCount = 5;
var msCloseEnough = 500; // 100 preferable, but will push it up for now for better demo reliability

function getMedian(values) {
	values.sort();
	var medianIdx = Math.floor(values.length / 2);
	return values[medianIdx];
}

function getMean(values) {
	var count = values.length;
	var total = 0;
	for (var i = 0; i < count; i++) {
		total += values[i];
	}
	return total / count;
}

function getAverage(values) {
	if (values.length > clientHistoryMaxCount) {
		values.shift();
	}
	return getMedian(values);
}

function getAverageLatency(client) {
	return getAverage(client.latencyHistory);
}

function checkClientLatency(clientSocket) {
	var pingTime = (new Date).getTime();
	clientSocket.emit('ping', {
		serverPingTime: pingTime
	});
}

function checkClientLatencyListener(socket, data) {
	var socketId = socket.id;
	var serverPingTime = data.serverPingTime;
	var clientPongTime = data.clientPongTime;
	var serverPongTime = (new Date).getTime();
	var clientLatency = (serverPongTime - serverPingTime) / 2
	var clientTimeOffset = clientPongTime - (serverPongTime - clientLatency);
	if (!clients[socketId]) {
		clients[socketId] = {
			socket: socket,
			latency: clientLatency,
			timeOffset: clientTimeOffset,
			latencyHistory: [clientLatency],
			timeOffsetHistory: [clientTimeOffset]
		}
	} else {
		var client = clients[socketId];
		client.latencyHistory.push(clientLatency);
		client.timeOffsetHistory.push(clientTimeOffset);
		client.latency = getAverage(client.latencyHistory);
		client.timeOffset = getAverage(client.timeOffsetHistory);
	}
	setTimeout(function() {
		checkClientLatency(socket);
	}, 4000);
	//flushClientDataToConsole();
}

function flushClientDataToConsole() {
	console.log('Client Data:');
	for (var socketId in clients) {
		if (!clients.hasOwnProperty(socketId)) {
			continue;
		}
		var client = clients[socketId];
		console.log('Client ' + socketId + ':');
		console.log('       User ID: ' + client.userId);
		console.log('       Latency: ' + client.latency);
		console.log('    TimeOffset: ' + client.timeOffset);
	}
}

function getGroupMemberList(group) {
	groupMembers = "";
	for (var i = 0; i < group.length; i++) {
		var bump = group[i];
		groupMembers += (i > 0 ? ', ' : '') + clients[bump.socketId].userId;
	}
	return groupMembers;
}

function flushBumpsAndGroupsToConsole() {
	console.log('Bumps:');
	for (var i = 0; i < bumps.length; i++) {
		var bump = bumps[i];
		console.log('Bump[' + i + '].id = ' + clients[bump.socketId].userId);
	}
	console.log('Groups:');
	for (var j = 0; j < groups.length; j++) {
		var group = groups[j];
		for (var k = 0; k < group.length; k++) {
			var bump = group[k];
			console.log('Group[' + j + '].Bump[' + k + '].id = ' + clients[bump.socketId].userId);
		}
	}
}

function areTimestampsCloseEnough(ts1, ts2) {
	//console.log('Measuring if close enough...');
	//console.log('ts1 - ts2 = ' + Math.abs(ts1 - ts2));
	var closeEnough = Math.abs(ts1 - ts2) < msCloseEnough;
	return closeEnough;
}

function addBumpToGroupWithoutDupes(group, bumpData) {
	for (var i = 0; i < group.length; i++) {
		if (group[i].socketId == bumpData.socketId) {
			return;
		}
	}
	group.push(bumpData);
}

function isPairInGroup(group, pair) {
	var pair0matched = false;
	var pair1matched = false;
	for (var i = 0; i < group.length; i++) {
		if (group[i].socketId == pair[0].socketId) {
			pair0matched = true;
		}
		if (group[i].socketId == pair[1].socketId) {
			pair1matched = true;
		}
	}
	return pair0matched && pair1matched;
}

function isInGroup(sessionId, group) {
	for (var i = 0; i < group.length; i++) {
		if (group[i].sessionId == sessionId) {
			return true;
		}
	}
	return false;
}

function areGroupsEqual(group1, group2) {
	if (group1.length != group2.length) {
		return false;
	}
	for (var i = 0; i < group1.length; i++) {
		if (!isInGroup(group1[i].sessionId, group2)) {
			return false;
		}
	}
	return true;
}

function pruneDupedGroups() {
	var giA = 0;
	while(giA < groups.length) {
		giB = giA + 1;
		while(giB < groups.length) {
			if (areGroupsEqual(groups[giA], groups[giB])) {
				console.log('Removing duplicate group [' + giB + ']: ' + getGroupMemberList(groups[giB]));
				groups.splice(giB, 1);
			} else {
				giB++;
			}
		}
		giA++;
	}
}

function addPairToGroupWithoutDupes(group, pair) {
	//if (isPairInGroup(group, pair)) {
	//	return;
	//}
	group.concat(pair);
	setTimeout(pruneDupedGroups, msCloseEnough * 2);
}

function addPairAsGroupWithoutDupes(pair) {
	//for (var i = 0; i < groups.length; i++) {
	//	if (isPairInGroup(groups[i], pair)) {
	//		return;
	//	}
	//}
	groups.push(pair);
	setTimeout(pruneDupedGroups, msCloseEnough * 2);
}

function findMatchingBumps(bumpData) {
	var pair = [];
	var myId;
	for (var i = bumps.length - 1; i >= 0; i--) {
		var bump = bumps[i];
		if (bumpData.socketId == bump.socketId) {
			myId = i;
			continue;
		}
		if (pair.length == 2) {
			continue;
		}
		if (areTimestampsCloseEnough(bumpData.timestamp, bump.timestamp)) {
			pair.push(bumpData);
			pair.push(bump);
			bumps.splice(myId, 1);
			bumps.splice(i, 1);
		}
	}
	for (var j = groups.length - 1; j >= 0; j--) {
		var group = groups[j];
		for (var k = group.length - 1; k >= 0; k--) {
			var bump = group[k];
			if (areTimestampsCloseEnough(bumpData.timestamp, bump.timestamp)) {
				if (pair.length > 0) {
					addPairToGroupWithoutDupes(group, pair);
					//console.log('Added pair to a group.');
				} else {
					addBumpToGroupWithoutDupes(group, bumpData);
					//console.log('Added bump to a group.');
				}
				return group;
			}
		}
	}
	if (pair.length > 0) {
		addPairAsGroupWithoutDupes(pair);
		//console.log('Added pair as new group.');
		return pair;
	}
	//console.log('No match found for bump.');
	return null;
}

function recordBump(bumpData) {
	for (var i = bumps.length - 1; i >= 0; i--) {
		if (bumps[i].socketId == bumpData.socketId) {
			bumps.splice(i, 1);
		}
	}
	bumps.push(bumpData);
	//flushBumpsAndGroupsToConsole();
}

function adjustForOffsetAndLatency(bumpData) {
	if (!bumpData) {
		return; //bad pong
	}
	var client = clients[bumpData.socketId];
	if (!client) {
		return; //bad pong
	}
	var clientTimeOffset = client.timeOffset;
	var clientLatency = client.latency;

	bumpData.timestamp -= clientLatency + clientTimeOffset;
}

function pruneUnpairedBumps() {
	for (var i = bumps.length - 1; i >= 0; i--) {
		var bump = bumps[i];
		var now = (new Date).getTime();
		if (now - bump.timestamp > (msCloseEnough * 2)) {
			bumps.splice(i, 1);
		}
	}
}

function deviceBumpedHandler(socket, bumpData) {
	//console.log('Bump from ' + socket.id);
	bumpData.socketId = socket.id;
	adjustForOffsetAndLatency(bumpData);
	recordBump(bumpData);
	setTimeout(function() {
		// Wait for additional bumps before attempting to match up the group
		var matchResult = findMatchingBumps(bumpData);
		if (matchResult == null) {
			socket.emit('unmatchedBump');
			//console.log('UNmatched bump!');
			//flushBumpsAndGroupsToConsole();
		} else {
			socket.emit('matchedBump', matchResult);
			console.log('Group Created: ' + getGroupMemberList(matchResult));
			setTimeout(function() {
				console.log('');
				console.log('All Groups:');
				for (var g = 0; g < groups.length; g++) {
					console.log('Group ' + g + ': ' + getGroupMemberList(groups[g]));
				}
				console.log('');
			}, msCloseEnough * 3);
			//console.log('matched bump!');
			//flushBumpsAndGroupsToConsole();
		}
	}, msCloseEnough);
}

function setDeviceUser(socket, userData) {
	//console.log('setting user data: ' + userData.userId);
	var client = clients[socket.id];
	if (userData.userId) {
		//console.log('setting user ' + socket.id + ' userId = ' + userData.userId + '...');
		client.userId = userData.userId;
	}
	console.log('Socket Connection ' + socket.id + ' is now ' + userData.userId + '.');
	//flushClientDataToConsole();
}

sio.configure(function() {
	sio.set('log level', 1);
});

sio.sockets.on('connection', function(socket) {
	console.log('Connection from ' + socket.id);
	checkClientLatency(socket);

	socket.on('setUser', function(data) {
		//console.log('setUser!');
		setDeviceUser(socket, data);
	});

	socket.on('deviceBumped', function(data) {
		//console.log('bump!');
		deviceBumpedHandler(socket, data);
	});

	socket.on('pong', function(data) {
		//console.log('pong!');
		checkClientLatencyListener(socket, data);
	});
});