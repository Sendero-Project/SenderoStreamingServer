// ********************************************************
// Dependencies and Settings
// ********************************************************

//
// Set here the port to receive Sendeo Server's stream:
const senderoServerUDPPort = 8080;
//
// Set here the port where Sendero Socket.IO Clients will connect to:
const socketIOServerPort = 8080;


const COMPRESSION_ENABLED_MASK = 0x01;

var http = require('http').createServer().listen(socketIOServerPort, '0.0.0.0');
console.log(`\n  ---->   Listening for Sendero Web Socket.io clients to connect in ${socketIOServerPort} port\n`);

var io = require('socket.io').listen(http);

var dgram = require('dgram');
var udpSocket = dgram.createSocket('udp4');
var MongoClient = require('mongodb').MongoClient;

var dashbboardClient = [];
var connectedUsers = -1;

// ********************************************************
// Main
// ********************************************************

// Connect to senderoDB
MongoClient.connect("mongodb://localhost:27017/senderoDB", function(err, db) {
  
  // Connection error
  if(err) { 
    return console.dir(err); 
  }

  // Create or open Collection: streamingStats
  db.createCollection('streamingStats', function(err, collection) {
    var connectedUsers = 0;;

    // Listen for Sendero Server connection
    udpSocket.on('message', function(data, rinfo) {
      /*
       * Streaming
       */
      io.sockets.emit('frame', {
        timestamp: data.readUIntBE(0, 8), // Read an 8 byte unsigned int that is BigEndian.
        sequence: data.readUInt8(8), // Read a 1 byte unsigned int.
        compression: (data.readUInt8(9) & COMPRESSION_ENABLED_MASK) == COMPRESSION_ENABLED_MASK,
        data: data.slice(10) // discard the timestamp from frameBuffer
      });

    });

    udpSocket.on('listening', function(){
      var address = udpSocket.address();
      console.log(`\n  ---->   Listening for Sendero Server streaming packets in ${address.port} udp port\n`);
    });

    udpSocket.on('error', function(err) {
      console.log(`--------------> Streaming Server error:\n${err.stack}`);
      udpSocket.close();
    });

    udpSocket.bind(senderoServerUDPPort);
    
    // Listen for Socket.io connections
    io.on('connection', function(client){

      console.log("Connected client: ", client.id);
      connectedUsers++;

      /*
       * Test Streaming
       */
      client.on('testFrame', function(frameData){
        client.broadcast.emit('frame', frameData);
      });

      /*
       * Stats
       */
      client.on('stat', function(stats){
        console.log("Stats received from: ", client.id);
        stats.clientId = client.id;
        collection.insert(stats);
        if (dashbboardClient.length > 0){
          collection.aggregate(
            [
              {$group :
                {_id : null, 
                  tsMean: { $avg: "$tsFrameRateMean"}, 
                  tsStdev: { $avg: "$tsFrameRateStdev"}, 
                  arrMean: { $avg: "$arrFrameRateMean"}, 
                  arrStdev: { $avg: "$arrFrameRatStdev"}, 
                  ptMean: { $avg: "$ptFrameRateMean"}, 
                  ptStdev: { $avg: "$ptFrameRateStdev"}, 
                  rpMean: { $avg: "$rpFrameRateMean"}, 
                  rpStdev: { $avg: "$rpFrameRateStdev"}, 
                  buffMean: { $avg: "$bufferSizeMean"},
                  count: {$sum: 1}
                }
              }
            ], function(err, result) {
              var data = result[0];
              data.clients = connectedUsers;
              for (var i = dashbboardClient.length - 1; i >= 0; i--) {
                dashbboardClient[i].emit('refreshStats', data, stats);
              }
            });
        }
      });

      /*
       * Dashboard user
       */
      client.on('registerAdmin', function(){
        console.log("Admin Registered with Id: ", client.id);
        dashbboardClient.push(client);
      });

      /*
       * User Disconnection
       */
      client.on('disconnect', function() {
        console.log("User disconnected: ", client.id);
        connectedUsers--;
      });

    });
  });
});

function exitHandler(options, err) {
  io.close();
  if (err) console.log(err.stack);
  if (options.exit) process.exit();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
